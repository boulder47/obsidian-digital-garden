import { MetadataCache, Notice, TFile, Vault, base64ToArrayBuffer, } from "obsidian";
import { Base64 } from "js-base64";
import { getRewriteRules } from "../utils/utils";
import {
	hasPublishFlag,
	isPublishFrontmatterValid,
} from "../publishFile/Validator";
import { PathRewriteRules } from "../repositoryConnection/DigitalGardenSiteManager";
import DigitalGardenSettings from "../models/settings";
import { Assets, GardenPageCompiler } from "../compiler/GardenPageCompiler";
import { CompiledPublishFile, PublishFile } from "../publishFile/PublishFile";
import Logger from "js-logger";
import { RepositoryConnection } from "../repositoryConnection/RepositoryConnection";
import fs from "fs/promises";
import * as path from 'path';
import {
	extractBaseUrl,
	generateUrlPath,
	getGardenPathForNote,
	getRewriteRules,
} from "../utils/utils";


export interface MarkedForPublishing {
	notes: PublishFile[];
	images: string[];
}

export const IMAGE_PATH_BASE = "src/site/";
export const NOTE_PATH_BASE = "src/site/notes/";


//const fullpath = "/Users/mobilevideoeditor/website/"

/**
 * Prepares files to be published and publishes them to Github
 */
export default class Publisher {
	vault: Vault;
	metadataCache: MetadataCache;
	compiler: GardenPageCompiler;
	settings: DigitalGardenSettings;
	rewriteRules: PathRewriteRules;

	constructor(
		vault: Vault,
		metadataCache: MetadataCache,
		settings: DigitalGardenSettings,
	) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.settings = settings;
		this.rewriteRules = getRewriteRules(settings.pathRewriteRules);


		this.compiler = new GardenPageCompiler(
			vault,
			settings,
			metadataCache,
			() => this.getFilesMarkedForPublishing(),
		);
	}

	shouldPublish(file: TFile): boolean {
		const frontMatter = this.metadataCache.getCache(file.path)?.frontmatter;

		return hasPublishFlag(frontMatter);
	}

	async getFilesMarkedForPublishing(): Promise<MarkedForPublishing> {
		const files = this.vault.getMarkdownFiles();
		const notesToPublish: PublishFile[] = [];
		const imagesToPublish: Set<string> = new Set();

		for (const file of files) {
			try {
				if (this.shouldPublish(file)) {
					const publishFile = new PublishFile({
						file,
						vault: this.vault,
						compiler: this.compiler,
						metadataCache: this.metadataCache,
						settings: this.settings,
					});

					notesToPublish.push(publishFile);

					const images = await publishFile.getImageLinks();

					images.forEach((i) => imagesToPublish.add(i));
				}
			} catch (e) {
				Logger.error(e);
			}
		}

		return {
			notes: notesToPublish.sort((a, b) => a.compare(b)),
			images: Array.from(imagesToPublish),
		};
	}

	async deleteNote(vaultFilePath: string, sha?: string) {
		const path = `${NOTE_PATH_BASE}${vaultFilePath}`;

		return await this.delete(path, sha);
	}

	async deleteImage(vaultFilePath: string, sha?: string) {
		const path = `${IMAGE_PATH_BASE}${vaultFilePath}`;

		return await this.delete(path, sha);
	}
	/** If provided with sha, garden connection does not need to get it seperately! */
	public async delete(path: string, sha?: string): Promise<boolean> {
		this.validateSettings();

		const userGardenConnection = new RepositoryConnection({
			gardenRepository: this.settings.githubRepo,
			githubUserName: this.settings.githubUserName,
			githubToken: this.settings.githubToken,
		});

		const deleted = await userGardenConnection.deleteFile(path, {
			sha,
		});

		return !!deleted;
	}

	public async publish(file: CompiledPublishFile): Promise<boolean> {
		if (!isPublishFrontmatterValid(file.frontmatter)) {
			return false;
		}

		try {
			const [text, assets] = file.compiledFile;
			await this.uploadText(file.getPath(), text, file?.remoteHash);
			await this.uploadAssets(assets);

			return true;
		} catch (error) {
			console.error(error);

			return false;
		}
	}

	public async deleteBatch(filePaths: string[]): Promise<boolean> {
		if (filePaths.length === 0) {
			return true;
		}

		try {
			const userGardenConnection = new RepositoryConnection({
				gardenRepository: this.settings.githubRepo,
				githubUserName: this.settings.githubUserName,
				githubToken: this.settings.githubToken,
			});

			await userGardenConnection.deleteFiles(filePaths);

			return true;
		} catch (error) {
			console.error(error);

			return false;
		}
	}

	public async publishBatch(files: CompiledPublishFile[]): Promise<boolean> {
		const filesToPublish = files.filter((f) =>
			isPublishFrontmatterValid(f.frontmatter),
		);

		if (filesToPublish.length === 0) {
			return true;
		}

		try {
			const userGardenConnection = new RepositoryConnection({
				gardenRepository: this.settings.githubRepo,
				githubUserName: this.settings.githubUserName,
				githubToken: this.settings.githubToken,
			});

			await userGardenConnection.updateFiles(filesToPublish);

			return true;
		} catch (error) {
			console.error(error);

			return false;
		}
	}

	private async uploadToGithub(
		path: string,
		content: string,
		remoteFileHash?: string,
	) {
		this.validateSettings();
		let message = `Update content ${path}`;

		const userGardenConnection = new RepositoryConnection({
			gardenRepository: this.settings.githubRepo,
			githubUserName: this.settings.githubUserName,
			githubToken: this.settings.githubToken,
		});

		if (!remoteFileHash) {
			const file = await userGardenConnection.getFile(path).catch(() => {
				// file does not exist
				Logger.info(`File ${path} does not exist, adding`);
			});
			remoteFileHash = file?.sha;

			if (!remoteFileHash) {
				message = `Add content ${path}`;
			}
		}

		return await userGardenConnection.updateFile({
			content,
			path,
			message,
			sha: remoteFileHash,
		});
	}

	private async uploadText(filePath: string, content: string, sha?: string) {
		content = Base64.encode(content);
		const path = `${NOTE_PATH_BASE}${filePath}`;
		await this.uploadToGithub(path, content, sha);
	}

	private async uploadImage(filePath: string, content: string, sha?: string) {
		const path = `src/site${filePath}`;
		await this.uploadToGithub(path, content, sha);
	}

	private async uploadAssets(assets: Assets) {
		for (let idx = 0; idx < assets.images.length; idx++) {
			const image = assets.images[idx];
			await this.uploadImage(image.path, image.content, image.remoteHash);
		}
	}

	validateSettings() {
		if (!this.settings.githubRepo) {
			new Notice(
				"Config error: You need to define a GitHub repo in the plugin settings",
			);
			throw {};
		}

		if (!this.settings.githubUserName) {
			new Notice(
				"Config error: You need to define a GitHub Username in the plugin settings",
			);
			throw {};
		}

		if (!this.settings.githubToken) {
			new Notice(
				"Config error: You need to define a GitHub Token in the plugin settings",
			);
			throw {};
		}
	}
	public async publishWriteBatch(files: CompiledPublishFile[]): Promise<boolean> {
		const filesToPublish = files.filter((f) =>
			isPublishFrontmatterValid(f.frontmatter),
		);

		if (filesToPublish.length === 0) {
			return true;
		}

		try {
			await this.writeTheseFiles(filesToPublish);
			return true;
		} catch (e) {
				Logger.error(e);

			return false;
		}
	}
	public async writeTheseFiles(files: CompiledPublishFile[]) {
		const normalizePath = (path: string) =>
			path.startsWith("/") ? path.slice(1) : path;
		const exportPath = this.settings.exportPath;
		const treePromises = files.map(async (file) => {
			const [text, _] = file.compiledFile;

			try {				
				const originalString = generateUrlPath(file.getPath());
				const urlPath = this.trimLastCharacters(originalString, 1);

				const newFilePath = `${exportPath}${NOTE_PATH_BASE}${urlPath}.md`;
				await this.writeFileWithDirectories(newFilePath, text);

				return true;
			} catch (e) {
				Logger.error(e);
			}
		});

		const treeAssetPromises = files
			.flatMap((x) => x.compiledFile[1].images)
			.map(async (asset) => {
				//const content = asset.content; 
				const arrayBuffer = base64ToArrayBuffer(asset.content);
				const content = Buffer.from(arrayBuffer)
				//const content = Base64.decode(asset.content); // Assuming `asset.content` contains the image content
				try {
					const newImagePath = `${exportPath}${IMAGE_PATH_BASE}${normalizePath(asset.path)}`;
					await this.writeFileWithDirectories(newImagePath, content);
					//await this.writeAssets([asset]); // Assuming `writeAssets` takes an array of assets

				return true;
					
				} catch (e) {
				Logger.error(e);
				}
			});
		

		// activate function here.
		await Promise.all(treePromises);
    	await Promise.all(treeAssetPromises);
	}
	public async publishToFolder(file: CompiledPublishFile): Promise<boolean> {
		if (!isPublishFrontmatterValid(file.frontmatter)) {
			return false;
		}

		try {
			const [text, assets] = file.compiledFile;
			await this.writeText(file.getPath(), text);
			await this.writeAssets(assets);

			return true;
		} catch (e) {
				Logger.error(e);

			return false;
		}
	}
	private async writeText(filePath: string, content: string) {
		const exportPath = this.settings.exportPath;
		const newFilePath = `${exportPath}${NOTE_PATH_BASE}${normalizePath(file.getPath())}`;
		try {
			await this.writeFileWithDirectories(newFilePath, content);
			} catch (e) {
				Logger.error(e);
			}
	}
	private async writeImage(filePath: string, content: string) {
		const exportPath = this.settings.exportPath;
		const newImagePath = `${exportPath}${IMAGE_PATH_BASE}${normalizePath(asset.path)}`;
		try {
			await this.writeFileWithDirectories(newFilePath, content);
			} catch (e) {
				Logger.error(e);
			}
	}
	private async writeAssets(assets: Assets) {
		for (let idx = 0; idx < assets.images.length; idx++) {
			const image = assets.images[idx];
			await this.writeImage(image.path, image.content);
		}
	}
	private async writeFileWithDirectories(filePath: string, content: string): Promise<void> {
  				const directoryPath = path.dirname(filePath);
 				const fileName = path.basename(filePath);
  				await this.ensureDirectoryExists(directoryPath);
  				await fs.writeFile(filePath, content);
  				console.log(`File ${fileName} written to ${directoryPath}`);
	}
	private async ensureDirectoryExists(dirPath: string): Promise<void> {
  				try {
    				await fs.access(dirPath);
 				} catch (error) {
    				await fs.mkdir(dirPath, { recursive: true });
  		}
	}
	trimLastCharacters(str: string, n: number): string {
    	if (n <= 0) {
        	return str;
    	}
    return str.slice(0, -n);
	}
}
