
import { join } from 'path';

import { fastify } from 'fastify';

import { FileSystemStorage, FileSystemStorageError } from '../src/send-stream';

const app = fastify();

const storage = new FileSystemStorage(join(__dirname, 'assets'));

app.route({
	method: ['HEAD', 'GET'],
	url: '*',
	handler: async (request, reply) => {
		let result = await storage.prepareResponse(request.url, request.raw);
		// if path is not found then rewrite to root index.html
		if (result.error instanceof FileSystemStorageError) {
			result.stream.destroy();
			const { error: { pathParts } } = result;
			result = await storage.prepareResponse(
				['', 'index.html'],
				request.raw,
				// if the mime type can be determined from path then this is probably an error so add 404 status
				storage.mimeTypeLookup(pathParts[pathParts.length - 1])
					? { statusCode: 404 }
					: {},
			);
		}
		await result.send(reply.raw);
	},
});

app.listen(3000, () => {
	console.info('listening on http://localhost:3000');
});
