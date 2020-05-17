
import * as http from 'http';
import { join } from 'path';

import { FileSystemStorage } from '../src/send-stream';

const storage = new FileSystemStorage(join(__dirname, 'assets'));

const app = http.createServer((req, res) => {
	(async () => {
		if (!req.url) {
			throw new Error('url not set');
		}
		const result = await storage.prepareResponse(req.url, req);
		result.send(res);
	})().catch(err => {
		console.error(err);
		if (res.headersSent) {
			res.destroy(err instanceof Error ? err : new Error(String(err)));
			return;
		}
		const message = 'Internal Server Error';
		res.writeHead(500, {
			'Content-Type': 'text/plain; charset=UTF-8',
			'Content-Length': String(Buffer.byteLength(message)),
		});
		res.end(message);
	});
});

app.listen(3000, () => {
	console.info('listening on http://localhost:3000');
});