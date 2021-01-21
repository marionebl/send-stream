
import { join } from 'path';

import { fastify } from 'fastify';

import { FileSystemStorage } from '../src/send-stream';

const app = fastify();

const storage = new FileSystemStorage(join(__dirname, 'assets'), { dynamicCompression: true });

app.route({
	method: ['HEAD', 'GET'],
	url: '*',
	handler: async (request, reply) => {
		const result = await storage.prepareResponse(request.url, request.raw);
		if (result.statusCode === 404) {
			reply.callNotFound();
			return;
		}
		await reply.code(result.statusCode)
			.headers(result.headers)
			.send(result.stream);
	},
});

app.listen(3000)
	.then(() => {
		console.info('listening on http://localhost:3000');
	})
	.catch(err => {
		console.error(err);
	});
