import type { AnyBot, TelegramUpdate, TelegramUser } from "gramio";
import { MessageObject } from "./objects/message.ts";
import { UserObject } from "./objects/user.ts";

export let lastUpdateId = 0;

export class TelegramTestEnvironment {
	private bot: AnyBot;

	public users: UserObject[] = [];

	constructor(bot: AnyBot) {
		this.bot = bot;
	}

	emitUpdate(update: TelegramUpdate | MessageObject) {
		if (update instanceof MessageObject) {
			return this.bot.updates.handleUpdate({
				update_id: lastUpdateId++,
				//@ts-expect-error
				message: update.payload,
			});
		}

		return this.bot.updates.handleUpdate(update);
	}

	createUser(user: Partial<TelegramUser> | UserObject = {}) {
		if (user instanceof UserObject) {
			this.users.push(user);
			return user;
		}

		const newUser = new UserObject(user);
		this.users.push(newUser);
		return newUser;
	}
}
