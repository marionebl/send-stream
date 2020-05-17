
# send-stream

[![NPM](https://img.shields.io/npm/v/send-stream.svg)](https://www.npmjs.com/package/send-stream)
[![Build Status](https://github.com/nicolashenry/send-stream/workflows/Node.js%20CI/badge.svg?branch=master)](https://github.com/nicolashenry/send-stream/actions?query=workflow%3A%22Node.js+CI%22+branch%3Amaster)
[![Coverage Status](https://coveralls.io/repos/github/nicolashenry/send-stream/badge.svg?branch=master)](https://coveralls.io/github/nicolashenry/send-stream?branch=master)

`send-stream` is a library for streaming files from the file system or any other source.

It supports partial responses (Ranges including multipart), conditional-GET negotiation (If-Match, If-Unmodified-Since, If-None-Match, If-Modified-Since) and precompressed content
encoding negociation.

It also have high test coverage, typescript typings
and has [multiple examples](examples/) using Express, Koa, Fastify or pure NodeJS http/http2 modules.

## Installation

This is a [Node.js](https://nodejs.org/en/) module available through the
[npm registry](https://www.npmjs.com/). Installation is done using the
[`npm install` command](https://docs.npmjs.com/getting-started/installing-npm-packages-locally):

```bash
$ npm install send-stream
```

## Getting start

Serve all files from a directory with Fastify, Koa or Express
(see [examples](#examples) folder for more advanced usages)

Using Fastify:
```js
const path = require('path');
const fastify = require('fastify');
const { FileSystemStorage } = require('send-stream');

const app = fastify();
const storage = new FileSystemStorage(path.join(__dirname, 'assets'));

app.get('*', async ({ req }, { res }) => {
	let result = await storage.prepareResponse(req.url, req);
	result.send(res);
});

app.listen(3000)
	.then(() => {
		console.info('listening on http://localhost:3000');
	});
```

Using Koa:
```js
const path = require('path');
const Koa = require('koa');
const { FileSystemStorage } = require('send-stream');

const app = new Koa<object>();
const storage = new FileSystemStorage(path.join(__dirname, 'assets'));

app.use(async ctx => {
	let result = await storage.prepareResponse(ctx.request.path, ctx.req);
	ctx.response.status = result.statusCode;
	ctx.response.set(result.headers);
	ctx.body = result.stream;
});

app.listen(3000, () => {
	console.info('listening on http://localhost:3000');
});
```

Using Express:
```js
const path = require("path");
const express = require("express");
const { FileSystemStorage } = require('send-stream');

const app = express();
const storage = new FileSystemStorage(path.join(__dirname, 'assets'));

app.get('*', async (req, res, next) => {
	try {
		let result = await storage.prepareResponse(req.url, req);
		result.send(res);
	} catch (err) {
		next(err);
	}
});
app.listen(3000, () => {
	console.info('listening on http://localhost:3000');
});
```

## API

### new FileSystemStorage(root, [options])

Create a new `FileSystemStorage` which is a stream storage giving access to the files inside the given root folder.

The **`root`** parameter is a the absolute path from which the storage takes the files.

The **`options`** parameter let you add some addition options.

#### Options

##### mimeModule

In order to return the content type, the storage will try to guess the content type thanks to the `mime` module
(see [mime module documentation](https://github.com/broofa/node-mime)).
This option override the mime module instance which will be used for this purpose.

Example:

```js
const Mime = require('mime/Mime');
const myMime = new Mime({
  'text/abc': ['abc']
});
new FileSystemStorage(directory, { mimeModule: myMime })
```

##### defaultContentType

Configures the default content type that will be used if the content type is unknown.

`undefined` by default

Example:

```js
new FileSystemStorage(directory, { defaultContentType: 'application/octet-stream' })
```

##### defaultCharsets

Configures the default charset that will be appended to the content type header.

`false` will disable it

The default is `[{ matcher: /^(?:text\/.+|application\/(?:javascript|json))$/, charset: 'UTF-8' }]`

Example:

```js
new FileSystemStorage(directory, { defaultCharsets: [{ matcher: /^(?:text\/html$/, charset: 'UTF-8' }] })
```

##### maxRanges

Configure how many ranges can be accessed in one request.

Defaults to `200`

Setting it to `1` will disable multipart/byteranges

Setting it to `0` or less will disable range requests

Example:

```js
new FileSystemStorage(directory, { maxRanges: 10 })
```

##### weakEtags

The storage will generate strong etags by default, when set to true the storage will generate weak etags instead.

`false` by default

Example:

```js
new FileSystemStorage(directory, { weakEtags: true })
```

##### contentEncodingMappings

Configure content encoding file mappings.

`undefined` by default

Example:

```js
new FileSystemStorage(
  directory,
  {
    contentEncodingMappings: [
      {
        matcher: /^(.+\.(?:html|js|css))$/,
        encodings: [
          { name: 'br', path: '$1.br' },
          { name: 'gzip', path: '$1.gz' }
        ]
      }
    ]
  }
)
```

##### ignorePattern

The storage will ignore files which have any parts of the path matching this pattern.

`false` will disable it

Defaults to `/^\../` (files/folders beginning with a dot)

Example:

```js
new FileSystemStorage(directory, { ignorePattern: /^myPrivateFolder$/ })
```

##### fsModule

Let you override the `fs` module that will be used to retrieve files.

Example:

```js
const memfs = require('memfs');
memfs.fs.writeFileSync('/hello.txt', 'world');
new FileSystemStorage(directory, { fsModule: memfs })
```

### storage.prepareResponse(path, req, [options])

Create asynchronously a new `StreamResponse` for the given path relative to root ready to be sent to a server response.

The **`path`** parameter is a urlencoded path (urlencoded) or an array of path parts (should always start with '').

For example, `'/my%20directory/index.html'` is the equivalent of `['', 'my directory', 'index.html']`.

Query params will be ignored if present.

The **`req`** is the related request, it can be a `http.IncomingMessage` or a `http2.Http2ServerRequest` or a `http2.IncomingHttpHeaders`.

The **`options`** parameter let you add some addition options.

#### Options

##### cacheControl

Custom cache-control header value, overrides storage value (`public, max-age=0` by default)

`false` to remove header

Example:

```js
await storage.prepareResponse(req.url, req, { cacheControl: 'public, max-age=31536000' })
```

##### lastModified

Custom last-modified header value, overrides storage value (defaults to mtimeMs converted to UTC)

`false` to remove header

Example:

```js
await storage.prepareResponse(req.url, req, { lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT' })
```

##### etag

Custom etag header value, overrides storage value (defaults to size + mtimeMs + content encoding)

`false` to remove header

Example:

```js
await storage.prepareResponse(req.url, req, { etag: '"123"' })
```

##### contentType

Custom content-type header value, overrides storage value (defaults to storage content type)

`false` to remove header

Example:

```js
await storage.prepareResponse(req.url, req, { contentType: 'text/plain' })
```

##### contentDispositionType

Custom content-disposition header type value, overrides storage value

`false` to remove header

Example:

```js
await storage.prepareResponse(req.url, req, { contentDispositionType: 'attachment' })
```

##### contentDispositionFilename

Custom content-disposition header filename value, overrides storage value

`false` to remove filename from header

Example:

```js
await storage.prepareResponse(req.url, req, { contentDispositionFilename: 'file.txt' })
```

##### statusCode

Defines the statusCode that will be used in response (instead of 200/206)
Setting this will disable conditional GET and partial responses

`undefined` by default

Example:

```js
await storage.prepareResponse(req.url, req, { statusCode: 404 })
```

##### allowedMethods

By default GET and HEAD are the only allowed http methods, set this parameter to change allowed methods

`['GET', 'HEAD']` by default

Example:

```js
await storage.prepareResponse(req.url, req, { allowedMethods: ['POST'] })
```

### streamResponse.statusCode

The status code that match the required resource.

For example, it can be 200 if the file is found, 206 for a range request, 404 if the file does not exists, ...

### streamResponse.headers

The headers that match the required resource.

### streamResponse.error

If an error occured while reading (e.g. if the file is not found),
a 404 status is returned and this property will contains the error
which have been returned by the storage. See [errors](#errors)

### streamResponse.send(res)

Send the current response through the response in parameter

The `res` is the related response, it can be a `http.ServerResponse` or a `http2.Http2ServerResponse` or a `http2.ServerHttp2Stream`.

## Errors

### error.code = 'malformed_path'

The path cannot be parsed for some reason.

### error.code = 'not_normalized_path'

Storages only accept normalized paths for security reasons.
Note this will redirect to the normalized path instead of 404.
For example, `'/../index.html'` will be refused and redirected to `'/index.html'`.

### error.code = 'forbidden_character'

Storages refuse some forbidden characters like encoded slashes.

### error.code = 'consecutive_slashes'

Storages refuse pathes like `'/dir//index.html'` because it should not contain two consecutive slashes.

### error.code = 'trailing_slash'

Storages refuse pathes like `'/dir/'` because it is probably pointing to a directory.

### error.code = 'ignored_file'

Storages can ignore some files/folders composing the path (see [ignorePattern](#ignorePattern)).

### error.code = 'is_directory'

Storages refuse pathes matching directories.

### error.code = 'does_not_exist'

When the file can not be found.

### error.code = 'unknown_error'

When any other error occurs.

## Examples

See `examples/` folder in this repository for full examples

### Serve directory with folder index.html files

```js
let result = (await storage.prepareResponse(req.url, req));
const error = result.error;
// if the path is not found and the reason is a trailing slash then try to load matching index.html
if (error && error instanceof FileSystemStorageError && error.code === 'trailing_slash') {
  result.stream.destroy();
  result = await storage.prepareResponse([...error.pathParts.slice(0, -1), 'index.html'], req);
}
result.send(res);
```

### Serve directory with file listing

```js
const path = require('path');
const fs = require('fs');
const util = require('util');

const readdir = util.promisify(fs.readdir);

...

const result = await storage.prepareResponse(req.url, req);
// if the path is not found and the reason is a trailing slash then try to load files in folder
if (result.error && result.error instanceof FileSystemStorageError && result.error.code === 'trailing_slash') {
  const { error: { pathParts } } = result;
  let files;
  try {
    files = await readdir(path.join(storage.root, ...pathParts), { withFileTypes: true });
  }
  catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(err);
    }
    // return the original error
    result.send(res);
    return;
  }
  result.stream.destroy();
  const display = pathParts.length > 2 ? pathParts[pathParts.length - 2] : '/';
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${display}</title>`;
  html += '<meta name="viewport" content="width=device-width"></head>';
  html += `<body><h1>Directory: ${ pathParts.join('/') }</h1><ul>`;
  if (pathParts.length > 2) {
    html += '<li><a href="..">..</a></li>';
  }
  for (const file of files) {
    const { ignorePattern } = storage;
    if (ignorePattern && ignorePattern.test(file.name)) {
      continue;
    }
    const filename = file.name + (file.isDirectory() ? '/' : '');
    html += `<li><a href="./${ filename }">${ filename }</a></li>`;
  }
  html += '</ul></body></html>';
  res.setHeader('Cache-Control', 'max-age=0');
  res.send(html);
  return;
}
result.send(res);
```

### Serve index.html for history.pushState application

```js
const { extname } = require('path');

...

let result = await storage.prepareResponse(req.url, req);
const error = result.error;
// serve root index.html unless path has extension
if (
  error
  && error instanceof FileSystemStorageError
  && (
    error.pathParts.length === 0
    || extname(error.pathParts[error.pathParts.length - 1]) === ''
  )
) {
  result.stream.destroy();
  result = await storage.prepareResponse(['', 'index.html'], req);
}
result.send(res);
```
## License

[MIT](LICENSE)
