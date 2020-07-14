
import * as fs from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { promisify } from 'util';

import { Storage } from './storage';
import { StorageRequestHeaders, StorageInfo, StorageError } from './storage-models';
import { acceptEncodings, StreamRange } from './utils';
import {
	FilePath,
	FileData,
	FSModule,
	FileSystemStorageOptions,
	RegexpContentEncodingMapping,
	MalformedPathError,
	NotNormalizedError,
	InvalidPathError,
	ConsecutiveSlashesError,
	ForbiddenCharacterError,
	IgnoredFileError,
	TrailingSlashError,
	IsDirectoryError,
	DoesNotExistError,
} from './file-system-storage-models';

declare const URL: typeof import('url').URL;

/**
 * Escape HTML in path for this library (only replace & character since ", < and > are already excluded)
 *
 * @param path - the path to escape
 * @returns the escaped path
 */
export function escapeHTMLInPath(path: string) {
	// & is the only character to escape. '<', '>' and '"' are already excluded from listing
	return path.replace(/&/ug, '&amp;');
}

// eslint-disable-next-line no-control-regex
export const FORBIDDEN_CHARACTERS = /[/?<>\\:*|":\u0000-\u001F\u0080-\u009F]/u;

/**
 * File system storage
 */
export class FileSystemStorage extends Storage<FilePath, FileData> {
	readonly root: string;

	readonly contentEncodingMappings: readonly RegexpContentEncodingMapping[] | false;

	readonly ignorePattern: RegExp | false;

	readonly fsOpen: (path: string, flags: number) => Promise<number>;

	readonly fsFstat: (fd: number) => Promise<fs.Stats>;

	readonly fsClose: (fd: number) => Promise<void>;

	readonly fsCreateReadStream: FSModule['createReadStream'];

	readonly fsOpendir?: (path: string) => Promise<fs.Dir>;

	readonly fsReaddir: (path: string, options: { withFileTypes: true }) => Promise<fs.Dirent[]>;

	readonly fsConstants: FSModule['constants'];

	readonly onDirectory: 'serve-index' | 'list-files' | false;

	/**
	 * Create file system storage
	 *
	 * @param root - root folder path
	 * @param opts - file system storage options
	 */
	constructor(
		root: string,
		opts: FileSystemStorageOptions = { },
	) {
		super(opts);
		this.root = root;
		const { contentEncodingMappings } = opts;
		if (contentEncodingMappings) {
			this.contentEncodingMappings = contentEncodingMappings.map(encodingConfig => {
				const encodingPreferences = new Map(
					encodingConfig.encodings.map(({ name, path }, order) => [name, { path, order }]),
				);
				let identityEncodingPreference = encodingPreferences.get('identity');
				if (!identityEncodingPreference) {
					identityEncodingPreference = { path: '$&', order: encodingConfig.encodings.length };
					encodingPreferences.set('identity', identityEncodingPreference);
				}
				const matcher = encodingConfig.matcher instanceof RegExp
					? encodingConfig.matcher
					: new RegExp(encodingConfig.matcher, 'u');
				return { matcher, encodingPreferences, identityEncodingPreference };
			});
		} else {
			this.contentEncodingMappings = false;
		}
		this.ignorePattern = opts.ignorePattern === undefined
			? /^\./u
			: opts.ignorePattern === false || opts.ignorePattern instanceof RegExp
				? opts.ignorePattern
				: new RegExp(opts.ignorePattern, 'u');
		this.onDirectory = opts.onDirectory ?? false;
		const fsModule = opts.fsModule === undefined ? fs : opts.fsModule;
		this.fsOpen = promisify(fsModule.open);
		this.fsFstat = promisify(fsModule.fstat);
		this.fsClose = promisify(fsModule.close);
		this.fsCreateReadStream = fsModule.createReadStream;
		this.fsOpendir = fsModule.opendir ? promisify(fsModule.opendir) : undefined;
		this.fsReaddir = promisify(fsModule.readdir);
		this.fsConstants = fsModule.constants;
	}

	/**
	 * Parse and check url encoded path or path array
	 *
	 * @param path - url encoded path or path array to be accessed from root
	 * @returns path array
	 * @throws when the path can not be parsed
	 */
	parsePath(path: FilePath) {
		let pathParts;

		if (typeof path === 'string') {
			if (!path.startsWith('/')) {
				throw new StorageError(
					`'${ path }' is not a valid path (should start with '/')`,
					path,
				);
			}
			const { pathname, search } = new URL(`http://localhost${ path }`);
			pathParts = pathname.split('/');
			try {
				pathParts = pathParts.map(decodeURIComponent);
			} catch (err) {
				throw new MalformedPathError(
					String(err),
					path,
					pathParts,
				);
			}
			const normalizedPath = pathname + search;
			if (path !== normalizedPath) {
				throw new NotNormalizedError(
					`${ String(path) } is not normalized`,
					path,
					pathParts,
					normalizedPath,
				);
			}
		} else {
			pathParts = path;
			if (
				pathParts.length === 0
				|| pathParts[0] !== ''
				|| pathParts.findIndex(part => /^\.\.?$/u.test(part)) !== -1
			) {
				throw new InvalidPathError(
					`[${
						String(path.map(v => `'${ v }'`).join(', '))
					}] is not a valid path array (should start with '' and not contain '..' or '.')`,
					path,
					pathParts,
				);
			}
		}

		const emptyPartIndex = pathParts.indexOf('', 1);
		let haveTrailingSlash = false;

		// trailing or consecutive slashes
		if (emptyPartIndex !== -1) {
			if (emptyPartIndex !== pathParts.length - 1) {
				throw new ConsecutiveSlashesError(
					`${ String(path) } have two consecutive slashes`,
					path,
					pathParts,
				);
			}
			haveTrailingSlash = true;
		}

		// slashes or null bytes
		if (pathParts.find(v => FORBIDDEN_CHARACTERS.test(v))) {
			throw new ForbiddenCharacterError(
				`${ String(path) } has one or more forbidden characters`,
				path,
				pathParts,
			);
		}

		// ignored files
		const { ignorePattern } = this;
		if (ignorePattern && pathParts.find(v => ignorePattern.test(v)) !== undefined) {
			throw new IgnoredFileError(
				`${ String(path) } is ignored`,
				path,
				pathParts,
			);
		}

		// trailing slash
		if (haveTrailingSlash) {
			const untrailedPathParts = pathParts.slice(0, -1);
			if (this.onDirectory === 'list-files') {
				pathParts = untrailedPathParts;
			} else if (this.onDirectory === 'serve-index') {
				pathParts = [...untrailedPathParts, 'index.html'];
				haveTrailingSlash = false;
			} else {
				throw new TrailingSlashError(
					`${ String(path) } have a trailing slash`,
					path,
					pathParts,
					untrailedPathParts,
				);
			}
		}

		return { pathParts, haveTrailingSlash };
	}

	/**
	 * Open file, return undefined if does not exist
	 *
	 * @param path - file path
	 * @returns file handle
	 */
	async safeOpen(path: string) {
		let fd;
		try {
			fd = await this.fsOpen(path, this.fsConstants.O_RDONLY);
		} catch {
			// noop if an error happens while trying to open file
		}
		return fd;
	}

	/**
	 * Get Stat object from file descriptor
	 *
	 * @param fd - file descriptor
	 * @param _path - file path (unused but can be useful for caching on override)
	 * @returns Stat object
	 */
	async stat(fd: number, _path: string) {
		return this.fsFstat(fd);
	}

	/**
	 * Close file descriptor
	 *
	 * @param fd - file descriptor
	 * @param _path - file path (unused but can be useful for caching on override)
	 * @returns Stat object
	 */
	async earlyClose(fd: number, _path: string) {
		return this.fsClose(fd);
	}

	/**
	 * Open file and retrieve storage information (filename, modification date, size, ...)
	 *
	 * @param path - file path
	 * @param requestHeaders - request headers
	 * @returns StorageInfo object
	 * @throws when the file can not be opened
	 */
	async open(path: FilePath, requestHeaders: StorageRequestHeaders): Promise<StorageInfo<FileData>> {
		let fd: number | undefined;
		const { pathParts, haveTrailingSlash } = this.parsePath(path);
		let resolvedPath = join(this.root, ...pathParts);
		let stats;
		let vary;
		let contentEncoding = 'identity';
		try {
			const { contentEncodingMappings: encodingsMappings } = this;
			let selectedEncodingMapping;
			// test path against encoding map
			if (!haveTrailingSlash && encodingsMappings) {
				selectedEncodingMapping = encodingsMappings.find(
					encodingMapping => encodingMapping.matcher.test(resolvedPath),
				);
			}
			if (selectedEncodingMapping) {
				const { encodingPreferences, identityEncodingPreference } = selectedEncodingMapping;
				// if path can have encoded version
				vary = 'Accept-Encoding';
				const acceptableEncodings = acceptEncodings(
					requestHeaders['accept-encoding'],
					encodingPreferences,
					identityEncodingPreference,
				);
				for (const [acceptableEncodingName, { path: acceptableEncodingPath }] of acceptableEncodings) {
					const encodedPath = resolvedPath.replace(
						selectedEncodingMapping.matcher,
						acceptableEncodingPath,
					);
					// eslint-disable-next-line no-await-in-loop
					fd = await this.safeOpen(encodedPath);
					if (fd === undefined) {
						continue;
					}
					// eslint-disable-next-line no-await-in-loop
					stats = await this.stat(fd, encodedPath);
					if (stats.isDirectory()) {
						if (acceptableEncodingName === 'identity') {
							throw new IsDirectoryError(
								`${ resolvedPath } is a directory`,
								path,
								pathParts,
								resolvedPath,
							);
						}
						const directoryFd = fd;
						fd = undefined;
						stats = undefined;
						// eslint-disable-next-line no-await-in-loop
						await this.earlyClose(directoryFd, encodedPath);
						continue;
					}
					contentEncoding = acceptableEncodingName;
					resolvedPath = encodedPath;
					break;
				}
				if (fd === undefined || !stats) {
					throw new DoesNotExistError(
						`${ resolvedPath } does not exist`,
						path,
						pathParts,
						resolvedPath,
					);
				}
			} else {
				// if path can not have encoded version
				fd = await this.safeOpen(resolvedPath);
				if (fd === undefined) {
					throw new DoesNotExistError(
						`${ resolvedPath } does not exist`,
						path,
						pathParts,
						resolvedPath,
					);
				}
				stats = await this.stat(fd, resolvedPath);
				if (stats.isDirectory()) {
					if (!haveTrailingSlash) {
						throw new IsDirectoryError(
							`${ resolvedPath } is a directory`,
							path,
							pathParts,
							resolvedPath,
						);
					}
					// fd cannot be used yet with opendir/readdir
					await this.earlyClose(fd, resolvedPath);
					return {
						attachedData: {
							pathParts,
							resolvedPath,
							fd,
							stats,
						},
						fileName: `${ pathParts.length > 1 ? pathParts[pathParts.length - 1] : '_' }.html`,
						mimeType: 'text/html',
						mimeTypeCharset: 'UTF-8',
					};
				} else if (haveTrailingSlash) {
					throw new TrailingSlashError(
						`${ String(path) } have a trailing slash but is not a directory`,
						path,
						[...pathParts, ''],
						pathParts,
					);
				}
			}
		} catch (err) {
			if (fd !== undefined) {
				await this.earlyClose(fd, resolvedPath);
			}
			throw err;
		}

		return {
			attachedData: {
				pathParts,
				resolvedPath,
				fd,
				stats,
			},
			fileName: pathParts[pathParts.length - 1],
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			vary,
			contentEncoding,
		};
	}

	/**
	 * Async generator method to return the directory listing as HTML
	 *
	 * @param storageInfo - storage information
	 */
	async *getDirectoryListing(storageInfo: StorageInfo<FileData>) {
		const { attachedData: { pathParts } } = storageInfo;

		const isNotRoot = pathParts.length > 1;
		const displayName = isNotRoot ? escapeHTMLInPath(pathParts[pathParts.length - 1]) : '/';
		const display = `${ isNotRoot ? escapeHTMLInPath(pathParts.join('/')) : '' }/`;

		yield `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${
			displayName
		}</title><meta name="viewport" content="width=device-width"><meta name="description" content="Content of ${
			display
		} directory"></head><body><h1>Directory: ${ display }</h1><ul>${
			isNotRoot ? '<li><a href="..">..</a></li>' : ''
		}`;

		const { ignorePattern } = this;
		const files = await this.opendir(storageInfo);

		for await (const file of files) {
			const { name: filename } = file;
			if (
				FORBIDDEN_CHARACTERS.test(filename)
				|| (ignorePattern && ignorePattern.test(filename))
			) {
				continue;
			}
			const escapedFilename = `${ escapeHTMLInPath(filename) }${ file.isDirectory() ? '/' : '' }`;
			yield `<li><a href="./${ escapedFilename }">${ escapedFilename }</a></li>`;
		}

		yield '</ul></body></html>';
	}

	/**
	 * Returns the list of files from a directory
	 *
	 * @param storageInfo - storage information
	 * @returns the list of files
	 */
	async opendir(storageInfo: StorageInfo<FileData>) {
		return this.fsOpendir
			? this.fsOpendir(storageInfo.attachedData.resolvedPath)
			: this.fsReaddir(storageInfo.attachedData.resolvedPath, { withFileTypes: true });
	}

	/**
	 * Create readable stream from storage information
	 *
	 * @param storageInfo - storage information
	 * @param range - range to use or undefined if size is unknown
	 * @param autoClose - true if stream should close itself
	 * @returns readable stream
	 */
	createReadableStream(
		storageInfo: StorageInfo<FileData>,
		range: StreamRange | undefined,
		autoClose: boolean,
	): Readable {
		const { attachedData } = storageInfo;
		if (attachedData.stats.isDirectory()) {
			return Readable.from(
				this.getDirectoryListing(storageInfo),
				{ objectMode: false, encoding: 'utf-8', highWaterMark: 16384 },
			);
		}
		return this.fsCreateReadStream(
			attachedData.resolvedPath,
			range === undefined
				? {
					fd: attachedData.fd,
					autoClose,
				}
				: {
					fd: attachedData.fd,
					autoClose,
					start: range.start,
					end: range.end,
				},
		);
	}

	/**
	 * Close storage information
	 *
	 * @param storageInfo - storage information
	 * @returns void
	 */
	async close(storageInfo: StorageInfo<FileData>): Promise<void> {
		return this.fsClose(storageInfo.attachedData.fd);
	}
}
