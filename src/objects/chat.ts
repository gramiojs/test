import type { TelegramChat } from "@gramio/types";
import type { UserObject } from "./user.ts";
import type { MessageObject } from "./message.ts";

export let lastChatId = 0;

export class ChatObject {
	public type = "chat";

	public payload: TelegramChat;

	public members = new Set<UserObject>();

	public messages: MessageObject[] = [];

	constructor(payload: Partial<TelegramChat> = {}) {
		this.payload = {
			id: ++lastChatId,
			type: "private",
			...payload,
		};
	}
}
