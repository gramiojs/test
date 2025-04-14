# @gramio/test

[![npm](https://img.shields.io/npm/v/@gramio/objects-builder?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/objects-builder)
[![npm downloads](https://img.shields.io/npm/dw/@gramio/objects-builder?logo=npm&style=flat&labelColor=000&color=3b82f6)](https://www.npmjs.org/package/@gramio/objects-builder)
[![JSR](https://jsr.io/badges/@gramio/test)](https://jsr.io/@gramio/test)
[![JSR Score](https://jsr.io/badges/@gramio/test/score)](https://jsr.io/@gramio/test)

# @gramio/test

A library for testing bots built with [GramIO](https://gramio.dev).

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { Bot, type ContextType } from "gramio";
import { TelegramTestEnvironment } from "../src/index.ts";
import { MessageObject } from "../src/objects/message.ts";

describe("TelegramTestEnvironment", () => {
    const bot = new Bot("test");
    let environment: TelegramTestEnvironment;

    beforeEach(() => {
        environment = new TelegramTestEnvironment(bot);
    });

    it("should create a user", () => {
        const user = environment.createUser();

        expect(user).toBeDefined();
        expect(environment.users).toContain(user);
    });

    it("should create a message", async () => {
        let receivedMessage: ContextType<Bot, "message"> | undefined;

        bot.on("message", (ctx) => {
            receivedMessage = ctx;
            console.log(ctx);
        });

        const user = environment.createUser();
        const message = new MessageObject({
            text: "Hello",
        }).from(user);

        await environment.emitUpdate(message);

        expect(receivedMessage).toBeDefined();
        expect(receivedMessage?.text).toBe("Hello");
        expect(receivedMessage?.from?.id).toBe(user.payload.id);
        expect(receivedMessage?.chat?.id).toBe(user.asChat.payload.id);
        expect(receivedMessage?.chat?.type).toBe("private");
        expect(receivedMessage?.id).toBe(message.payload.message_id);
        expect(receivedMessage?.createdAt).toBe(message.payload.date);
    });
});
```
