sdk-resource-express-node-js
============================

Express middleware for checking bearer tokens on incoming requests.

This library integrates into the resource or authorization server
back-end JavaScript using NodeJS.

Use this library to validate access tokens or client tokens on incoming
requests.

# Usage

To integrate this library with a resource or authorization server
you will need two imports. One is
for this library, the other one is for a token driver that validates
the tokens. In this example, we use the hashing token driver:

```
const { WebauthzTokenMemoryDatabase } = require('@webauthz/sdk-token-data-node-js');
const { WebauthzToken } = require('@webauthz/sdk-token-core-node-js');
const { WebauthzExpress } = require('@webauthz/sdk-resource-express-memory-js');
```

Then, create an instance of the WebauthzExpress class and configure it:

```
// webauthz token manager with in-memory database
const webauthzToken = new WebauthzToken({
    database: new WebauthzMemoryDatabase(),
});
const webauthzExpress = new WebauthzExpress({
    plugin: webauthzToken,
});
```

A resource server should configure the WebauthzExpress middleware
like this:

```
const webauthzResourceExpress = new WebauthzExpress({
    plugin: webauthzToken,
    realm: 'Webauthz',
    path: '/resource',
    webauthz_discovery_uri: `${ENDPOINT_URL}/webauthz.json`
});
```

Then, add the middleware to resource routes:

```
// resource management requires authenticated session or access token
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.scope('resource'), httpGetResource);
```

An authorization server should configure the WebauthzExpress middleware
like this:

```
const webauthzAuthorizationExpress = new WebauthzExpress({
    plugin: webauthzToken
}); 
```

Then, add the middleware to Webauthz client routes:

```
// authorization header with client token is required to exchange grant tokens for access tokens
expressApp.post('/webauthz/exchange', webauthzAuthorizationExpress.scope('webauthz:client'), bodyParser.json(), httpPostWebauthzExchange);
```

A route handler can check if a request includes a valid Webauthz bearer token like this:

```
if (!req.webauthz.isPermitted()) {
    return req.webauthz.json({ error: 'unauthorized' });
}
```

The `req.webauthz.json` function returns an error response with a '401 Unauthorized' status and a `WWW-Authenticate` header
containing a Webauthz challenge.

# API

## middleware

Example usage:

```
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.middleware(), httpGetResource);
```

Returns an Express middleware function that checks incoming requests for a Webauthz token,
validates the token if found, and makes the validated attributes available via `req.webauthz`.

Parameters: none

Return value: a middleware function (req, res, next)

## scope

Example usage:

```
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.scope('calendar','contacts'), httpGetResource);
```

Returns an Express middleware function that checks incoming requests for a Webauthz token,
validates the token if found, and makes the validated attributes available via `req.webauthz`.

Parameters:

* `...scopes` (string varargs, optional) one or more scopes to check when the route calls `req.webauthz.isPermitted()`

Return value: a middleware function (req, res, next)

# Webauthz Token

The library uses an abstract `plugin` object to validate incoming tokens.
The application must provide an object that implements the plugin
interface documented here.

See also [sdk-token-core-node-js](https://github.com/webauthz/sdk-token-core-node-js/) for
an implementation of the interface.

## checkToken

Example usage:

```
const tokenInfo = await webauthzPlugin.checkToken(bearerToken);
```

Validate a token.

Parameters:

* `param0` (string, required) the bearer token value

Return value: If successful, returns the validated token info. Otherwise, throws an exception.

# req.webauthz

The middleware creates a `webauthz` property on the HTTP request object that API functions
can use to check if a request includes a valid Webauthz bearer token, and also to include
a Webauthz challenge in the response when needed.

## isPermitted

Example usage 1, with scopes defined by route configuration:

```
if (!req.webauthz.isPermitted()) {
    return req.webauthz.json({ error: 'unauthorized' });
}
```

Example usage 2, with scopes defined by implementation:

```
if (!req.webauthz.isPermitted('calendar','contacts')) {
    return req.webauthz.json({ error: 'unauthorized' });
}
```

Check if an HTTP request includes a token that has been assigned each of
the specified scopes.

In the first usage, the scopes are defined by the coute configuration,
like this:

```
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.scope('calendar','contacts'), httpGetResource);
```
 
In the second usage, the route configuration adds the middleware without
scopes, because they are specified by the implementation:

```
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.middleware(), httpGetResource);
```

You can also combine the two approaches, using a route configuration to protect
one or more routes with a minimum set of scopes, and specifying additional
scopes in the implementation:

```
expressApp.get('/resource/:resourceId', session, webauthzResourceExpress.scope('calendar','contacts'), httpGetResource);

if (!req.webauthz.isPermitted() || !req.webauthz.isPermitted('more','here')) {
    return req.webauthz.json({ error: 'unauthorized' });
}
```

Whether scopes are defined by the route configuration or by the the
implementation, each of the specified scopes is required. You can guard
blocks of code with alternative permissions like this:

```
if (req.webauthz.isPermitted('calendar:view') || req.webauthz.isPermitted('admin')) {
    // allow showing the calendar
}
```

Parameters:

* `...scopes` (string varargs, optional) one or more scopes to check instead of the configured scopes; if empty checks the configured scopes

Return value: true if all of the specified scopes are granted to the client, otherwise false

## header

Example usage:

```
if (!req.webauthz.isPermitted()) {
    req.webauthz.header();
    return res.render('error', { message: 'you do not have permission for this resource' });
}
```

Add a Webauthz challenge to the HTTP response and set the response status code to 401 (Unauthorized).

Parameters: none

Return value: none

## empty

Example usage:

```
if (!req.webauthz.isPermitted()) {
    return req.webauthz.empty();
}
```

Add a Webauthz challenge to the HTTP response, set the response status code to 401 (Unauthorized),
and finish the response with an empty body.

Parameters: none

Return value: none

> NOTE: this is a convenience method; you can use `req.webauthz.header()` in combination with
> any other response headers that you render by other means

## json

Example usage:

```
if (!req.webauthz.isPermitted()) {
    return req.webauthz.json({ error: 'unauthorized' });
}
```

Add a Webauthz challenge to the HTTP response, set the response status code to 401 (Unauthorized),
set the content type to 'application/json', and finish the response with a JSON representation
of the input.

Parameters:

* `param0` (any, required) input to serialize as JSON for the response body

Return value: none

> NOTE: this is a convenience method; you can use `req.webauthz.header()` in combination with
> any other response headers and response body that you render by other means

## html

Example usage:

```
if (!req.webauthz.isPermitted()) {
    return req.webauthz.html('<html>...</html>');
}
```

Add a Webauthz challenge to the HTTP response, set the response status code to 401 (Unauthorized),
set the content type to 'text/html', and finish the response with the specified input as the
response body.

Parameters:

* `param0` (string, required) HTML for the response body

Return value: none

> NOTE: this is a convenience method; you can use `req.webauthz.header()` in combination with
> any other response headers and response body that you render by other means

# Build

```
npm run lint
npm run build
```
