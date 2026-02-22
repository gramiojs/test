export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

let lastFileId = 0;
export function genFile() {
	const id = ++lastFileId;
	return { file_id: `file_${id}`, file_unique_id: `unique_${id}` };
}
