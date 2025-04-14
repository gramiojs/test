import type { TelegramUser } from "@gramio/types";
import { ChatObject } from "./chat.ts";

export const lastUserId = 0;

export class UserObject {
	payload: TelegramUser;

	asChat: ChatObject;

	constructor(payload: Partial<TelegramUser> = {}) {
		this.payload = {
			id: lastUserId + 1,
			first_name: `User ${lastUserId + 1}`,
			is_bot: false,
			...payload,
		};

		this.asChat = new ChatObject({
			id: this.payload.id,
			type: "private",
		});
	}
}
