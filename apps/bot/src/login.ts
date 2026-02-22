// @ts-ignore
import input from 'input';
import {Logger} from "@/logger.js";
import * as fs from "node:fs";
import path from "node:path";
import {createClient} from "@/client.js";

export async function login() {
    const client = createClient(false);
    await client.start({
        phoneNumber: async () => await input.text('Enter your phone number: '),
        password: async (hint) => await input.text(`Please enter your 2FA Code Configured (Hint-if-configured: ${hint}): `),
        phoneCode: async () => await input.text("Please enter the code you received in telegram:: "),
        onError: (err) => console.log(err),
    })

    Logger.log('Logged in successfully');
    const sessionToken  = client.session.save();
    saveSession(sessionToken as unknown as string);
    Logger.log('Stopping client...')
    await client.disconnect();
}


function saveSession(sessionToken: string) {
    const now = new Date();

    const formattedDate = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");

    const formattedTime = [
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
    ].join("-");

    const fileName = `.token-${formattedDate}-${formattedTime}`;
    const filePath = path.join(process.cwd(), fileName);

    fs.writeFileSync(filePath, sessionToken, { encoding: "utf-8" });

    console.log(`Session token saved to ${fileName}`);
}