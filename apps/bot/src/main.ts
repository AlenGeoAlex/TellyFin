import {Environment} from "@/types/env.type.js";
import {login} from "@/login.js";
import {start} from "@/userbot.js";
import {JDownloader} from "@/jdownloader.js";

async function main() {
    console.log('Starting bot...');
    if(Environment.get().options.RUN_AS === 'LOGIN'){
        await login()
    }else{
        await start();
    }
}

// const jd = new JDownloader(Environment.get().options.JDOWNLOADER_URL!);
// await jd.clearList();
// const x = await jd.addDlcForLinkGrab({
//     path: '/Users/alenalex/Downloads/41b3ebe5.dlc'
// })
//
// setInterval(async () => {
//     //await jd.queryLinkCrawlingJob(x.id)
//     console.log(await jd.isCollecting())
//     const res = await jd.queryLink(x.id)
// }, 1000)
await main();