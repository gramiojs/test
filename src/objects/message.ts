import type { TelegramChat, TelegramMessage, TelegramUser } from "gramio";
import type { Optional } from "../utils.ts";
import { ChatObject } from "./chat.ts";
import { UserObject } from "./user.ts";

export const lastMessageIdPerChat = new Map<number, number>();

export class MessageObject {
	public type = "message";
	public payload: Optional<TelegramMessage, "chat">;

	constructor(payload: Partial<TelegramMessage> = {}) {
		this.payload = {
			message_id: lastMessageIdPerChat.get(payload.chat?.id ?? 0) ?? 0,
			date: Date.now(),
			...payload,
		};
	}

	from(user: TelegramUser | UserObject) {
		if (user instanceof UserObject) {
			this.payload.from = user.payload;
		} else {
			this.payload.from = user;
		}

		if (!this.payload.chat) {
			this.payload.chat = new ChatObject({
				id: this.payload.from.id,
				type: "private",
			}).payload;

			if (!lastMessageIdPerChat.has(this.payload.chat.id)) {
				lastMessageIdPerChat.set(
					this.payload.chat.id,
					this.payload.message_id ?? 0,
				);
			}
		}

		return this;
	}

	chat(chat: ChatObject | TelegramChat) {
		if (chat instanceof ChatObject) {
			this.payload.chat = chat.payload;
		} else {
			this.payload.chat = chat;
		}

		if (!lastMessageIdPerChat.has(this.payload.chat.id)) {
			lastMessageIdPerChat.set(
				this.payload.chat.id,
				this.payload.message_id ?? 0,
			);
		}

		return this;
	}
}
