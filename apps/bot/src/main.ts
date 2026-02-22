import {Environment} from "@/types/env.type.js";
import {login} from "@/login.js";
import {start} from "@/userbot.js";

async function main() {
    console.log('Starting bot...');
    if(Environment.get().options.RUN_AS === 'LOGIN'){
        await login()
    }else{
        await start();
    }
}

await main();