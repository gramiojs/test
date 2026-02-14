import type { TelegramCallbackQuery } from "@gramio/types";
import type { MessageObject } from "./message.ts";
import { UserObject } from "./user.ts";

let lastCallbackQueryId = 0;

export class CallbackQueryObject {
	public payload: TelegramCallbackQuery;

	constructor(payload: Partial<TelegramCallbackQuery> = {}) {
		this.payload = {
			id: String(++lastCallbackQueryId),
			from: { id: 0, is_bot: false, first_name: "Unknown" },
			chat_instance: String(Date.now()),
			...payload,
		};
	}

	from(user: UserObject) {
		this.payload.from = user.payload;
		return this;
	}

	message(message: MessageObject) {
		this.payload.message = message.payload as TelegramCallbackQuery["message"];
		return this;
	}

	data(data: string) {
		this.payload.data = data;
		return this;
	}
}
