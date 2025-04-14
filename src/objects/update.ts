import type { TelegramUpdate } from "gramio";

export class UpdateObject {
	constructor(public payload: TelegramUpdate) {}
}
