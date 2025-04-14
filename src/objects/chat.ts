import type { TelegramChat, TelegramUser } from "@gramio/types";
import type { UserObject } from "./user.ts";

export let lastChatId = 0;

export class ChatObject {
	public type = "chat";

	public payload: TelegramChat;

	constructor(payload: Partial<TelegramChat> = {}) {
		this.payload = {
			id: ++lastChatId,
			type: "private",
			...payload,
		};
	}
}
