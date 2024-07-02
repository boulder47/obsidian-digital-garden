import Publisher from "../../publisher/Publisher";
import { Notice, Platform } from "obsidian";
import DigitalGardenSettings from "../../models/settings";
import fs from "fs/promises";
import * as path from 'path';

const EXPORT_PATH = "src/test/tes.md";

export const GardenExport = async (
	settings: DigitalGardenSettings,
	publisher: Publisher,
) => {
	const devPluginPath = settings.devPluginPath;

	if (!devPluginPath) {
		new Notice("devPluginPath missing, run generateGardenSettings.mjs");
		return;
	}
	const marked = await publisher.getFilesMarkedForPublishing();
	let fileString = "Notes: \n";
	fileString += marked.images.map((path) => `${path}\n`);

	const assetPaths = new Set<string>();

	for (const file of marked.notes) {
		const [content, assets] =
			await publisher.compiler.generateMarkdown(file);
			assets.images.map((image) => assetPaths.add(image.path));
		let location = `${file.getPath()}`;
		let filecontent = `${content}\n`;
		const compiledExportPath = `${devPluginPath}/${location}`;
		if (Platform.isDesktop) {
			async function ensureDirectoryExists(dirPath: string): Promise<void> {
  				try {
    				await fs.access(dirPath);
 				} catch (error) {
    				await fs.mkdir(dirPath, { recursive: true });
  				}
			}
			async function writeFileWithDirectories(filePath: string, content: string): Promise<void> {
  				const directoryPath = path.dirname(filePath);
 				const fileName = path.basename(filePath);
  				await ensureDirectoryExists(directoryPath);
  				await fs.writeFile(filePath, content);
  				console.log(`File ${fileName} written to ${directoryPath}`);
				}
			writeFileWithDirectories(compiledExportPath, filecontent);
		}
	}		
	const named = await  getGardenPathForNote(marked.notes.file);

	fileString += "==========\n";
	const fullExportPath = `${devPluginPath}/${EXPORT_PATH}`;

	if (Platform.isDesktop) {
		await fs.writeFile(fullExportPath, fileString);
	}
	new Notice(`Snapshot written to ${fullExportPath}`);
	new Notice(`Check snapshot to make sure nothing has accidentally changed`);


};

	