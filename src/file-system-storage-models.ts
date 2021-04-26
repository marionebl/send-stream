import type { Readable } from 'stream';
import type { Dir, Stats, Dirent } from 'fs';

import type { StorageOptions } from './storage-models.js';
import { StorageError } from './storage-models.js';

/**
 * File data used by storage
 */
export interface GenericFileData<FileDescriptor> {
	/**
	 * Path parts used from root
	 */
	pathParts: readonly string[];
	/**
	 * Resolved path with path parts joined with root
	 */
	resolvedPath: string;
	/**
	 * File stats
	 */
	stats: Stats;
	/**
	 * File descriptor
	 */
	fd: FileDescriptor;
}

// eslint-disable-next-line @typescript-eslint/no-type-alias
export type FileData = GenericFileData<number>;

/**
 * "fs" module like type used by this library
 */
export interface GenericFSModule<FileDescriptor> {
	constants: {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		O_RDONLY: number;
	};
	open: (
		path: string,
		flags: number,
		callback: (err: NodeJS.ErrnoException | null, fd: FileDescriptor) => void
	) => void;
	fstat: (fd: FileDescriptor, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void) => void;
	close: (fd: FileDescriptor, callback: (err: NodeJS.ErrnoException | null) => void) => void;
	createReadStream: (
		path: string,
		options: {
			fd?: FileDescriptor;
			start?: number;
			end?: number;
			autoClose: boolean;
		}
	) => Readable;
	opendir?: (
		path: string,
		callback: (err: NodeJS.ErrnoException | null, dir: Dir) => void
	) => void;
	readdir: (
		path: string,
		options: { withFileTypes: true },
		callback: (err: NodeJS.ErrnoException | null, files: Dirent[]) => void
	) => void;
}

// eslint-disable-next-line @typescript-eslint/no-type-alias
export type FSModule = GenericFSModule<number>;

/**
 * Content encoding path
 */
export interface ContentEncodingPath {
	/**
	 * Content encoding name (will be used in content-encoding header if the file is found)
	 */
	name: string;
	/**
	 * Path location (will replace $* groups from matched regexp)
	 */
	path: string;
}

/**
 * Content encoding mapping
 */
export interface ContentEncodingMapping {
	/**
	 * Regexp used to match file path
	 */
	matcher: RegExp | string;
	/**
	 * Encodings to search once file path is matched
	 */
	encodings: readonly ContentEncodingPath[];
}

/**
 * Content encoding preference
 */
export interface ContentEncodingPreference {
	/**
	 * Order of preference
	 */
	readonly order: number;
	/**
	 * Path to match
	 */
	readonly path: string;
}

/**
 * Content encoding mapping
 */
export interface RegexpContentEncodingMapping {
	/**
	 * Regexp used to match file path
	 */
	matcher: RegExp;
	/**
	 * Encodings to search once file path is matched
	 */
	encodingPreferences: ReadonlyMap<string, ContentEncodingPreference>;
	/**
	 * Identity encoding preference
	 */
	identityEncodingPreference: ContentEncodingPreference;
}

/**
 * FileSystemStorage options
 */
export interface GenericFileSystemStorageOptions<FileDescriptor> extends StorageOptions {
	/**
	 * Content encoding mapping, e.g. [{ matcher: /^(.+\\.json)$/, encodings: [{ name: 'gzip', path: '$1.gz' }] }]
	 */
	contentEncodingMappings?: readonly ContentEncodingMapping[];
	/**
	 * Ignore pattern, defaults to /^\../ (files/folders beginning with a dot)
	 */
	ignorePattern?: RegExp | string | false;
	/**
	 * "fs" module to use
	 */
	fsModule: GenericFSModule<FileDescriptor>;
	/**
	 * Determine what should happen on directory requests (trailing slash)
	 * - `false` to return an error
	 * - `'list-files'` to list the files of directories
	 * - `'serve-index'` to serve the index.html file of directories
	 *
	 * Default to false
	 */
	onDirectory?: 'serve-index' | 'list-files' | false;
}

type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;

// eslint-disable-next-line @typescript-eslint/no-type-alias
export type FileSystemStorageOptions = Optional<GenericFileSystemStorageOptions<number>, 'fsModule'>;

/**
 * URL encoded path or path parts
 */
export type FilePath = string | readonly string[];

/**
 * File system storage error
 */
export class FileSystemStorageError extends StorageError<FilePath> {
	readonly pathParts: readonly string[];

	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path);
		this.name = 'FileSystemStorageError';
		this.pathParts = pathParts;
	}
}

/**
 * File system storage error
 */
export class MalformedPathError extends FileSystemStorageError {
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'MalformedPathError';
	}
}

/**
 * File system storage error
 */
export class NotNormalizedError extends FileSystemStorageError {
	normalizedPath: string;
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path
	 * @param pathParts - path parts relative to root
	 * @param normalizedPath - encoded path or path parts
	 */
	constructor(message: string, path: string, pathParts: readonly string[], normalizedPath: string) {
		super(message, path, pathParts);
		this.name = 'NotNormalizedError';
		this.normalizedPath = normalizedPath;
	}
}

/**
 * File system storage error
 */
export class InvalidPathError extends FileSystemStorageError {
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'InvalidPathError';
	}
}

/**
 * File system storage error
 */
export class ConsecutiveSlashesError extends FileSystemStorageError {
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'ConsecutiveSlashesError';
	}
}

/**
 * File system storage error
 */
export class IgnoredFileError extends FileSystemStorageError {
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'IgnoredFileError';
	}
}

/**
 * File system storage error
 */
export class ForbiddenCharacterError extends FileSystemStorageError {
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'ForbiddenCharacterError';
	}
}

/**
 * File system storage error
 */
export class TrailingSlashError extends FileSystemStorageError {
	untrailedPathParts: readonly string[];
	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts relative to root
	 * @param untrailedPathParts - path parts relative to root (without trailing slash)
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[], untrailedPathParts: readonly string[]) {
		super(message, path, pathParts);
		this.name = 'TrailingSlashError';
		this.untrailedPathParts = untrailedPathParts;
	}
}

/**
 * File system storage error
 */
export class IsDirectoryError extends FileSystemStorageError {
	/**
	 * Resolved path
	 */
	readonly resolvedPath: string;

	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts
	 * @param resolvedPath - resolved path
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[], resolvedPath: string) {
		super(message, path, pathParts);
		this.name = 'IsDirectoryError';
		this.resolvedPath = resolvedPath;
	}
}

/**
 * File system storage error
 */
export class DoesNotExistError extends FileSystemStorageError {
	/**
	 * Resolved path
	 */
	readonly resolvedPath: string;

	/**
	 * Create file system storage error
	 *
	 * @param message - error message
	 * @param path - encoded path or path parts
	 * @param pathParts - path parts
	 * @param resolvedPath - resolved path
	 */
	constructor(message: string, path: FilePath, pathParts: readonly string[], resolvedPath: string) {
		super(message, path, pathParts);
		this.name = 'DoesNotExistError';
		this.resolvedPath = resolvedPath;
	}
}

