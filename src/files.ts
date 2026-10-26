import type { TelegramFile } from "@gramio/types";
import { snapshot } from "./utils.ts";

/** Per-environment Telegram file identities and optional upload bodies. */
export class FileRegistry {
	private sequence = 0;
	private entries = new Map<string, Record<string, unknown> & TelegramFile>();
	private bodies = new Map<string, Blob>();
	private uploads = new WeakMap<Blob, string>();
	private urls = new Map<string, string>();
	private nextId() {
		let id: string;
		do {
			id = `upload_${++this.sequence}`;
		} while (this.entries.has(id));
		return id;
	}

	register(input: string | Blob, metadata: Record<string, unknown> = {}) {
		const url = typeof input === "string" && /^https?:\/\//i.test(input);
		const id =
			typeof input === "string"
				? url
					? (this.urls.get(input) ?? this.nextId())
					: input
				: (this.uploads.get(input) ?? this.nextId());
		const previous = this.entries.get(id);
		const file = {
			...previous,
			...snapshot(metadata),
			file_id: id,
			file_unique_id:
				previous?.file_unique_id ??
				(typeof metadata.file_unique_id === "string"
					? metadata.file_unique_id
					: `unique_file_${++this.sequence}`),
			file_path: previous?.file_path ?? `files/${encodeURIComponent(id)}`,
			...(typeof input === "string"
				? {}
				: {
						file_size: input.size,
						...(input.type ? { mime_type: input.type } : {}),
						...(typeof File !== "undefined" && input instanceof File
							? { file_name: input.name }
							: {}),
					}),
		};
		this.entries.set(id, file);
		if (url) this.urls.set(input, id);
		if (typeof input !== "string") {
			this.uploads.set(input, id);
			this.bodies.set(id, input);
		}
		return snapshot(file);
	}

	get(id: string): TelegramFile | undefined {
		const file = this.entries.get(id);
		if (!file) return undefined;
		return snapshot({
			file_id: file.file_id,
			file_unique_id: file.file_unique_id,
			file_path: file.file_path,
			file_size: file.file_size,
		});
	}

	async bytes(id: string): Promise<ArrayBuffer> {
		const body = this.bodies.get(id);
		if (!body)
			throw new Error(
				`No bytes registered for file ${id}; use env.registerFile(blob) and reuse its file_id`,
			);
		return body.arrayBuffer();
	}
}

/** Resolve GramIO's promised uploads without traversing arbitrary user objects. */
export async function resolveUploads(
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const result = { ...params };
	for (const key of [
		"photo",
		"video",
		"audio",
		"document",
		"voice",
		"animation",
		"video_note",
		"sticker",
		"thumbnail",
		"cover",
		"media",
	]) {
		const value = await result[key];
		if (Array.isArray(value))
			result[key] = await Promise.all(
				value.map((item) => resolveUploads(item)),
			);
		else if (
			key === "media" &&
			value &&
			typeof value === "object" &&
			!(value instanceof Blob)
		)
			result[key] = await resolveUploads(value as Record<string, unknown>);
		else if (value !== undefined) result[key] = value;
	}
	return result;
}
