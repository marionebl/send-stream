/* eslint-env node, mocha */

import * as assert from 'assert';
import * as http from 'http';
import * as path from 'path';

import request from 'supertest';

import {
	FileSystemStorageOptions,
	FileSystemStorage,
	PrepareResponseOptions,
	FileSystemStorageError,
} from '../src/send-stream';

const fixtures = path.join(__dirname, '/fixtures-static');

function createServer(
	dir?: string,
	opts?: PrepareResponseOptions & FileSystemStorageOptions,
	fn?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
) {
	const direct = dir ?? fixtures;

	const storage = new FileSystemStorage(direct, opts);

	return http.createServer((req, res) => {
		(async () => {
			if (fn) {
				fn(req, res);
			}
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			let result = await storage.prepareResponse(req.url!, req, opts);
			if (result.error
				&& result.error instanceof FileSystemStorageError
				&& result.error.code === 'trailing_slash'
			) {
				result.stream.destroy();
				result = await storage.prepareResponse(
					[...result.error.pathParts.slice(0, -1), 'index.html'],
					req,
					opts,
				);
			}
			if (result.error) {
				result.headers['X-Send-Stream-Error'] = result.error.code;
			}
			result.send(res);
		})().catch(err => {
			console.error(err);
			if (!res.headersSent) {
				res.statusCode = 500;
				res.end('Internal Server Error');
			}
		});
	});
}

function shouldNotHaveHeader(header: string) {
	return (res: request.Response) => {
		const { [header.toLowerCase()]: value } = <{ [key: string]: string }> res.header;
		assert.strictEqual(
			value,
			undefined,
			`should not have header ${ header } (actual value: "${ value }")`,
		);
	};
}

describe('serveStatic()', () => {
	describe('basic operations', () => {
		let server: http.Server;
		before(() => {
			server = createServer();
		});

		it('should serve static files', async () => {
			await request(server)
				.get('/todo.txt')
				.expect(200, '- groceries');
		});

		it('should support nesting', async () => {
			await request(server)
				.get('/users/tobi.txt')
				.expect(200, 'ferret');
		});

		it('should set Content-Type', async () => {
			await request(server)
				.get('/todo.txt')
				.expect('Content-Type', 'text/plain; charset=UTF-8')
				.expect(200);
		});

		it('should set Last-Modified', async () => {
			await request(server)
				.get('/todo.txt')
				.expect('Last-Modified', /\d{2} \w{3} \d{4}/u)
				.expect(200);
		});

		it('should default max-age=0', async () => {
			await request(server)
				.get('/todo.txt')
				.expect('Cache-Control', 'public, max-age=0')
				.expect(200);
		});

		it('should support urlencoded pathnames', async () => {
			await request(server)
				.get('/foo%20bar')
				.expect(200, 'baz');
		});

		it('should not choke on auth-looking URL', async () => {
			await request(server)
				.get('//todo@txt')
				.expect('X-Send-Stream-Error', 'consecutive_slashes')
				.expect(404);
		});

		it('should support index.html', async () => {
			await request(server)
				.get('/users/')
				.expect(200)
				.expect('Content-Type', /html/u)
				.expect('<p>tobi, loki, jane</p>');
		});

		it('should support HEAD', async () => {
			await request(server)
				.head('/todo.txt')
				.expect(res => {
					assert.ok((<string | undefined> res.text) === undefined, 'should not have body');
				})
				.expect(200);
		});

		it('should skip POST requests', async () => {
			await request(server)
				.post('/todo.txt')
				.expect(405);
		});

		it('should support conditional requests', async () => {
			const res = await request(server)
				.get('/todo.txt');
			await request(server)
				.get('/todo.txt')
				.set('If-None-Match', (<{ [key: string]: string }> res.header).etag)
				.expect(304);
		});

		it('should support precondition checks', async () => {
			await request(server)
				.get('/todo.txt')
				.set('If-Match', '"foo"')
				.expect(412);
		});

		it('should serve zero-length files', async () => {
			await request(server)
				.get('/empty.txt')
				.expect(200, '');
		});

		it('should ignore hidden files', async () => {
			await request(server)
				.get('/.hidden')
				.expect('X-Send-Stream-Error', 'ignored_file')
				.expect(404);
		});
	});

	describe('acceptRanges', () => {
		describe('when false', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { maxRanges: 0 });
			});
			it('should include Accept-Ranges none', async () => {
				await request(server)
					.get('/nums')
					.expect('Accept-Ranges', 'none')
					.expect(200, '123456789');
			});

			it('should ignore Range request header', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=0-3')
					.expect('Accept-Ranges', 'none')
					.expect(shouldNotHaveHeader('Content-Range'))
					.expect(200, '123456789');
			});
		});

		describe('when true', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { maxRanges: 1 });
			});
			it('should include Accept-Ranges', async () => {
				await request(server)
					.get('/nums')
					.expect('Accept-Ranges', 'bytes')
					.expect(200, '123456789');
			});

			it('should obey Rage request header', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=0-3')
					.expect('Accept-Ranges', 'bytes')
					.expect('Content-Range', 'bytes 0-3/9')
					.expect(206, '1234');
			});
		});
	});

	describe('cacheControl', () => {
		describe('when false', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { cacheControl: false });
			});
			it('should not include Cache-Control', async () => {
				await request(server)
					.get('/nums')
					.expect(shouldNotHaveHeader('Cache-Control'))
					.expect(200, '123456789');
			});
		});

		describe('when true', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { cacheControl: 'public, max-age=0' });
			});
			it('should include Cache-Control', async () => {
				await request(server)
					.get('/nums')
					.expect('Cache-Control', 'public, max-age=0')
					.expect(200, '123456789');
			});
		});
	});

	describe('fallthrough', () => {
		describe('when false', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { });
			});

			it('should 405 when OPTIONS request', async () => {
				await request(server)
					.options('/todo.txt')
					.expect('Allow', 'GET, HEAD')
					.expect(405);
			});

			it('should 404 when URL malformed', async () => {
				await request(server)
					.get('/%')
					.expect('X-Send-Stream-Error', 'malformed_path')
					.expect(404);
			});

			it('should 301 when traversing past root', async () => {
				await request(server)
					.get('/users/../../todo.txt')
					.expect('Location', '/todo.txt')
					.expect(301);
			});
		});
	});

	describe('hidden files', () => {
		let server: http.Server;
		before(() => {
			server = createServer(fixtures, { ignorePattern: false });
		});

		it('should be served when dotfiles: "allow" is given', async () => {
			await request(server)
				.get('/.hidden')
				.expect(200, 'I am hidden');
		});
	});

	describe('lastModified', () => {
		describe('when false', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { lastModified: false });
			});
			it('should not include Last-Modifed', async () => {
				await request(server)
					.get('/nums')
					.expect(shouldNotHaveHeader('Last-Modified'))
					.expect(200, '123456789');
			});
		});

		describe('when true', () => {
			let server: http.Server;
			before(() => {
				server = createServer(fixtures, { });
			});
			it('should include Last-Modifed', async () => {
				await request(server)
					.get('/nums')
					.expect('Last-Modified', /^\w{3}, \d+ \w+ \d+ \d+:\d+:\d+ \w+$/u)
					.expect(200, '123456789');
			});
		});
	});

	describe('when traversing past root', () => {
		let server: http.Server;
		before(() => {
			server = createServer(fixtures, { });
		});

		it('should catch urlencoded ../', async () => {
			await request(server)
				.get('/users/%2e%2e/%2e%2e/todo.txt')
				.expect('Location', '/todo.txt')
				.expect(301);
		});

		it('should not allow root path disclosure', async () => {
			await request(server)
				.get('/users/../../fixtures/todo.txt')
				.expect('Location', '/fixtures/todo.txt')
				.expect(301);
		});

		it('should catch urlencoded ../ bis', async () => {
			await request(server)
				.get('/users/%2e%2e/%2e%2e/static.spec.ts')
				.expect('Location', '/static.spec.ts')
				.expect(301);
		});

		it('should not allow root path disclosure bis', async () => {
			await request(server)
				.get('/users/../../fixtures/static.spec.ts')
				.expect('Location', '/fixtures/static.spec.ts')
				.expect(301);
		});
	});

	describe('when request has "Range" header', () => {
		let server: http.Server;
		before(() => {
			server = createServer();
		});

		it('should support byte ranges', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=0-4')
				.expect('12345');
		});

		it('should be inclusive', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=0-0')
				.expect('1');
		});

		it('should set Content-Range', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=2-5')
				.expect('Content-Range', 'bytes 2-5/9');
		});

		it('should support -n', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=-3')
				.expect('789');
		});

		it('should support n-', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=3-')
				.expect('456789');
		});

		it('should respond with 206 "Partial Content"', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=0-4')
				.expect(206);
		});

		it('should set Content-Length to the # of octets transferred', async () => {
			await request(server)
				.get('/nums')
				.set('Range', 'bytes=2-3')
				.expect('Content-Length', '2')
				.expect(206, '34');
		});

		describe('when last-byte-pos of the range is greater than current length', () => {
			it('is taken to be equal to one less than the current length', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=2-50')
					.expect('Content-Range', 'bytes 2-8/9');
			});

			it('should adapt the Content-Length accordingly', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=2-50')
					.expect('Content-Length', '7')
					.expect(206);
			});
		});

		describe('when the first- byte-pos of the range is greater than the current length', () => {
			it('should respond with 416', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=9-50')
					.expect(416);
			});

			it('should include a Content-Range header of complete length', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'bytes=9-50')
					.expect('Content-Range', 'bytes */9')
					.expect(416);
			});
		});

		describe('when syntactically invalid', () => {
			it('should respond with 200 and the entire contents', async () => {
				await request(server)
					.get('/nums')
					.set('Range', 'asdf')
					.expect('123456789');
			});
		});
	});
});
