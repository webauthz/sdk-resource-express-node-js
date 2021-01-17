/*!
Copyright (C) 2021 Cryptium Corporation. All rights reserved.
*/

/*
NOTE: this plugin uses a single table for client tokens and access tokens; the difference between
these token types is that client tokens are immediately issued in response to a registration request,
and have a special 'webauthz:client' scope, whereas access tokens are only issued upon completion
of the webauthz protocol between the application and the authorization server, and are assigned a
realm according to the resource configuration; authorization server apis that need the client info
can then look it up using req.webauthz.client_id; resource server apis that need the user info
can look it up using req.webauthz.user_id (if the authorization server filled in user_id when issuing the access token)

To use custom log implementation:
const webauthz = new WebauthzExpress({ log: customLogObject });

The custom log object must have the following functions:
* trace(string)
* info(string)
* warn(string)
* error(string)

To use Node's console object (the default):
const webauthz = new WebauthzExpress({ log: console });

To use Node's console object but disable trace output:
an object like this that uses the console log: { trace: (str) => {}, info: (str) => { console.info(str); }, warn: (str) => { console.warn(str); }, error: (str) => { console.error(str); } }

You can set the arbitrary, human-readable realm name (the default is 'Webauthz'):
const webauthz = new WebauthzExpress({ realm: 'Example' });

You can set the path prefix where clients can safely send the access token with requests (the default is '/'):
const webauthz = new WebauthzExpress({ path: '/api' });

You must set the webauthz_discovery_uri where clients can discover the authorization server settings,
for resources that support webauthz (if you do not set this, the middleware will NOT generate the WWW-Authenticate header):
const webauthz = new WebauthzExpress({ webauthz_discovery_uri: 'https://webauthz.com/discovery.json' });

Add to express app:
app.use(webauthz.middleware());

How to use the middleware to require that clients have specific scope when accessing a resource:
app.use(function (req, res) {
    if (req.webauthz.client_id) {
        console.log(`client is authenticated: ${req.webauthz.client_id}`);
    }

    if (req.webauthz.isPermitted('profile')) {
        // allow access to 'profile'
        return res.json({ name: 'sparky' });
    } else {
        return req.webauthz.empty(); // set status to 401, generate WWW-Authenticate with pre-configured scope list, return empty response body
        return req.webauthz.json({ error: 'unauthorized' }); // set status to 401, generate WWW-Authenticate with pre-configured scope list, return json response body
        return req.webauthz.html('<html>...</html>'); // set status to 401, generate WWW-Authenticate with pre-configured scope list, return html response body
        // OR
        req.webauthz.header(); // set status to 401, generate WWW-Authenticate with pre-configured scope list, do NOT send a response body
        return res.json({ error: 'unauthorized' });  // send our own response body
    }
});

How to require a specific scope for just one route:
app.use('/profile', webauthz.scope('profile'), function (req, res) {...});

How to require multiple scopes for just one route with a comma-separated list:
app.use('/profile', webauthz.scope('profile', 'calendar'), function (req, res) {...});

How to require a specific scope for a particular route, or set of routes, without repeating it in each one:
routes.use(webauthz.scope('profile'));
app.use('/profile', routes);
*/
class WebauthzExpress {
    /**
     * the `log` parameter default to console
     *
     * the `realm`, `path`, and `webauthz_discovery_uri` are optional; if they are present, the `WWW-Authenticate` header can be generated for responses
     *
     * the `plugin` parameter must be an object with a checkToken method that takes one parameter
     * which is the token input (everything after 'Bearer ' in the `Authorization` header), validates
     * the token, and returns an object with the validated token info or throws an exception
     * 
     * @param {*} param0 an object (required) with the following properties: `log` (optional, object), `plugin` (required, object), `realm` (optional, string), `path` (optional, string), `webauthz_discovery_uri` (optional, string)
     */
    constructor({ log = console, plugin, realm, path, webauthz_discovery_uri }) {
        this.log = log;

        if (plugin) {
            this.plugin = plugin;
        } else {
            throw new Error('plugin is required');
        }

        if (realm) {
            this.realm = realm;
        } else {
            this.realm = 'Webauthz';
        }

        if (path) {
            this.path = path;
        } else {
            this.path = '/';
        }

        if (webauthz_discovery_uri) {
            this.webauthz_discovery_uri = webauthz_discovery_uri;
        }
    }

    middleware({ requiredScopeList = [] } = {}) {
        return async (req, res, next) => {
            this.log.trace(`middleware: request headers ${JSON.stringify(req.headers)}`);
            this.log.trace(`middleware: request body ${JSON.stringify(req.body)}`);

            let authorization = null;

            // NOTE: curently assuming the Authorization header is single-valued
            const authorizationHeader = req.header('Authorization');
            this.log.trace(`middleware: header value ${JSON.stringify(authorizationHeader)}`);

            if (typeof authorizationHeader !== 'string') {
                this.log.trace('middleware: no authorization header in request');
                authorization = { error: 'authorization-header-not-found' };
            } else if (!authorizationHeader.toLowerCase().startsWith('bearer ')) {
                this.log.trace('middleware: authorization header not bearer');
                authorization = { error: 'authorization-header-not-bearer' };
            } else {
                const tokenInput = authorizationHeader.substr('bearer '.length).trim();

                try {
                    const tokenInfo = await this.plugin.checkToken(tokenInput);

                    const { not_after } = tokenInfo; // { type, client_id, realm, scope, not_after, user_id, error }
    
                    if (typeof not_after === 'number' && Date.now() > not_after) {
                        this.log.trace('middleware: token expired');
                        authorization = { error: 'token-expired' };
                    } else {
                        this.log.trace('middleware: valid token');
                        authorization = tokenInfo;
                    }
                } catch (err) {
                    this.log.error('middleware: valid token', err);
                    authorization = { error: 'invalid-token'};
                }
    
            }

            this.log.trace(`middleware: authorization result: ${JSON.stringify(authorization)}`);

            // prepare webauthz object that application can interact with
            const api = {};

            // allow access to read-only attributes describing the client request
            ['type', 'client_id', 'realm', 'scope', 'not_after', 'user_id', 'error'].forEach((item) => {
                Object.defineProperty(api, item, {
                    value: authorization[item],
                    enumerable: true,
                    configurable: false,
                    writable: false,
                });
            });

            // set 401 unauthorized status and generate www-authenticate header
            Object.defineProperty(api, 'header', {
                value: () => {
                    this.log.trace('middleware: header status 401');
                    res.status(401);

                    // resource server must define webauthz_discovery_uri to generate www-authenticate header
                    if (this.webauthz_discovery_uri) {
                        this.log.trace('middleware: header www-authenticate');
                        const scopeEncoded = encodeURIComponent(requiredScopeList.join(' '));
                        const realmEncoded = encodeURIComponent(this.realm);
                        const pathEncoded = encodeURIComponent(this.path);
                        const webauthzDiscoveryUriEncoded = encodeURIComponent(this.webauthz_discovery_uri);
                        res.set('WWW-Authenticate', `Bearer realm=${realmEncoded}, scope=${scopeEncoded}, webauthz_discovery_uri=${webauthzDiscoveryUriEncoded}, path=${pathEncoded}`);
                    }
                },
                enumerable: false,
                configurable: false,
                writable: false,
            });

            // allow application to easily return an empty response with 401 status and www-authenticate header
            Object.defineProperty(api, 'empty', {
                value: () => {
                    // set the 401 status and the www-authenticate header
                    api.header();

                    this.log.trace('middleware: empty');
                    return res.end();
                },
                enumerable: false,
                configurable: false,
                writable: false,
            });

            // allow application to easily return an empty response with 401 status and www-authenticate header
            Object.defineProperty(api, 'json', {
                value: (data) => {
                    // set the 401 status and the www-authenticate header
                    api.header();

                    this.log.trace('middleware: json');
                    return res.json(data); // express automatically sets content-type to application/json for object or array response
                },
                enumerable: false,
                configurable: false,
                writable: false,
            });

            // allow application to easily return an empty response with 401 status and www-authenticate header
            Object.defineProperty(api, 'html', {
                value: (data) => {
                    // set the 401 status and the www-authenticate header
                    api.header();

                    this.log.trace('middleware: html');
                    return res.send(data); // express automatically sets content-type to text/html for string response
                },
                enumerable: false,
                configurable: false,
                writable: false,
            });


            // allow application to declare that a specific permission is required to proceed
            // without parameters, checks if the client has ALL the *pre-defined* scopes required for the resource
            // with a parameter, checks if the client has ALL the *specified* scopes, ignoring the pre-defined scopes for the resource
            Object.defineProperty(api, 'isPermitted', {
                value: (...scope) => {
                    const checkScopeList = [];
                    if (scope.length > 0) {
                        checkScopeList.push(...scope);
                    } else {
                        checkScopeList.push(...requiredScopeList);
                    }

                    if (!authorization.scope) {
                        return false;
                    }

                    const granted = authorization.scope.split(' ');

                    const isPermitted = checkScopeList.every((value) => {
                        return granted.includes(value);
                    });

                    return isPermitted;
                },
                enumerable: false,
                configurable: false,
                writable: false,
            });

            Object.defineProperty(req, 'webauthz', {
                value: api,
                enumerable: true,
                configurable: false,
                writable: false,
            });

            this.log.trace('middleware: next...');

            next();
        
        };
    }

    scope(...requiredScopeList) {
        this.log.trace(`middleware: init with requiredScopeList ${JSON.stringify(requiredScopeList)}`);
        return this.middleware({ requiredScopeList });
    }

}

export { WebauthzExpress };
