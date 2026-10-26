import { describe, expect, it, spyOn } from "bun:test";
import { Bot, bold, format } from "gramio";
import {
	CallbackQueryObject,
	ChosenInlineResultObject,
	InlineQueryObject,
	MessageObject,
	PreCheckoutQueryObject,
	ShippingQueryObject,
	TelegramTestEnvironment,
} from "../src/index.ts";

describe("builder fixtures through user actions", () => {
	const attachments = {
		photo: () => new MessageObject().photo(),
		video: () => new MessageObject().video(),
		document: () => new MessageObject().document(),
		audio: () => new MessageObject().audio(),
		sticker: () => new MessageObject().sticker(),
		voice: () => new MessageObject().voice(),
		video_note: () => new MessageObject().videoNote(),
		animation: () => new MessageObject().animation(),
		contact: () => new MessageObject().contact({ first_name: "Alice" }),
		location: () => new MessageObject().location({ latitude: 1, longitude: 2 }),
		dice: () => new MessageObject().dice({ emoji: "🎯" }),
		venue: () => new MessageObject().venue({ title: "Office" }),
		game: () => new MessageObject().game({ title: "Game" }),
		story: () =>
			new MessageObject().story({ id: 1, chat: { id: -1, type: "channel" } }),
		poll: () => new MessageObject().poll({ question: "Question?" }),
	} as const;
	for (const kind of Object.keys(attachments) as (keyof typeof attachments)[]) {
		it(`delivers a ${kind} fixture with actor, chat and topic intact`, async () => {
			const env = new TelegramTestEnvironment(new Bot("test"));
			const user = env.createUser();
			const group = env.createChat({ type: "supergroup", is_forum: true });
			const fixture = attachments[kind]().chat(group).topicMessage(7);
			const sent = await user.send(fixture);
			expect(sent.payload[kind]).toEqual(fixture.payload[kind]);
			expect(sent.payload.from?.id).toBe(user.payload.id);
			expect(env.updates[0]?.message?.chat.id).toBe(group.payload.id);
			expect(env.updates[0]?.message?.message_thread_id).toBe(7);
		});
	}
	it("retains formatted quotes, explicit entities and structural flags", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const original = await user.sendMessage("quoted text");
		const fixture = new MessageObject()
			.from(user.payload)
			.text("reply")
			.entities({ type: "bold", offset: 0, length: 5 })
			.replyTo(original)
			.quote(format`${bold("quoted")}`)
			.protect()
			.effectId("effect")
			.viaBot(env.botUser)
			.linkPreviewOptions({ is_disabled: true });
		const sent = await user.send(fixture);
		expect(sent.payload).toMatchObject({
			quote: {
				text: "quoted",
				entities: [{ type: "bold", offset: 0, length: 6 }],
			},
			has_protected_content: true,
			effect_id: "effect",
			link_preview_options: { is_disabled: true },
		});
		expect(sent.payload.entities).toHaveLength(1);
		const photo = await user.send(
			new MessageObject()
				.photo()
				.caption("caption")
				.captionEntities({ type: "italic", offset: 0, length: 7 })
				.spoiler()
				.mediaGroupId("album"),
		);
		expect(photo.payload.caption_entities).toHaveLength(1);
		expect(photo.payload).toMatchObject({
			has_media_spoiler: true,
			media_group_id: "album",
		});
		expect(
			new MessageObject().quote("raw", []).payload.quote?.entities,
		).toEqual([]);
	});
	it("preserves formatted captions and edits them without stale entities", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const photo = await user.sendPhoto({ caption: format`${bold("before")}` });
		expect(photo.payload.caption_entities).toHaveLength(1);
		await user.on(photo).editCaption("after");
		expect(photo.payload.caption_entities).toBeUndefined();
		expect(env.updates[0]?.message?.caption).toBe("before");
		expect(env.updates[1]?.edited_message?.caption).toBe("after");
	});
	it("keeps fixture poll and payment IDs unique with a frozen clock", () => {
		const clock = spyOn(Date, "now").mockReturnValue(1);
		try {
			expect(new MessageObject().poll({}).payload.poll?.id).not.toBe(
				new MessageObject().poll({}).payload.poll?.id,
			);
			expect(
				new MessageObject().successfulPayment().payload.successful_payment
					?.telegram_payment_charge_id,
			).not.toBe(
				new MessageObject().successfulPayment().payload.successful_payment
					?.telegram_payment_charge_id,
			);
		} finally {
			clock.mockRestore();
		}
	});
});

describe("query builders", () => {
	it("delivers inline/callback builders with their configured identities", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const message = await user.sendMessage("menu");
		const inline = new InlineQueryObject()
			.from(user)
			.query("cats")
			.offset("10");
		await env.emitUpdate({ update_id: 0, inline_query: inline.payload });
		const chosen = new ChosenInlineResultObject()
			.from(user)
			.resultId("cat")
			.query("cats");
		await env.emitUpdate({
			update_id: 0,
			chosen_inline_result: chosen.payload,
		});
		const callback = new CallbackQueryObject()
			.from(user)
			.message(message)
			.data("cat");
		await env.emitUpdate({ update_id: 0, callback_query: callback.payload });
		expect(env.updates[1]?.inline_query).toMatchObject({
			from: user.payload,
			query: "cats",
			offset: "10",
		});
		expect(env.updates[2]?.chosen_inline_result?.result_id).toBe("cat");
		expect(env.updates[3]?.callback_query?.data).toBe("cat");
	});
	it("builds payment queries without losing address defaults or order information", async () => {
		const env = new TelegramTestEnvironment(new Bot("test"));
		const user = env.createUser();
		const query = new PreCheckoutQueryObject()
			.from(user)
			.currency("USD")
			.totalAmount(500)
			.invoicePayload("order")
			.shippingOptionId("express")
			.orderInfo({ name: "Alice" });
		await env.emitUpdate({ update_id: 0, pre_checkout_query: query.payload });
		const shipping = new ShippingQueryObject()
			.from(user)
			.invoicePayload("order")
			.shippingAddress({ city: "Berlin", country_code: "DE" });
		await env.emitUpdate({ update_id: 0, shipping_query: shipping.payload });
		expect(env.updates[0]?.pre_checkout_query).toMatchObject({
			currency: "USD",
			total_amount: 500,
			invoice_payload: "order",
			shipping_option_id: "express",
			order_info: { name: "Alice" },
		});
		expect(env.updates[1]?.shipping_query?.shipping_address).toMatchObject({
			city: "Berlin",
			country_code: "DE",
			street_line1: "1 Market St",
		});
	});
});
