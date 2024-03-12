const express = require('express');
const app = express();
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 5000

const config = {
   channelAccessToken:process.env.ACCESS_TOKEN,
   channelSecret:process.env.CHANNEL_SECRET
};

// line.Client の代わりに line.ClientBuilder を使用
const client = new line.ClientBuilder(config).build();

app
   .post('/hook',line.middleware(config),(req,res)=> lineBot(req,res))
   .listen(PORT,()=>console.log(`Listening on ${PORT}`));


// lineBot関数
// 参考↓ evの中身
// ev: {
//     type: 'follow',
//     replyToken: 'xxxxxxxxxxxxx',
//     source: { userId: 'yyyyyyyyyyyy', type: 'user'},
//     timestamp: 1601078188945,
//     mode: 'active'
//     }
const lineBot = async (req, res) => {
res.status(200).end();
const events = req.body.events;

const processEvent = async (ev) => {
    switch(ev.type){
        case 'follow':
            await greeting_follow(ev);
            break;
        // 他のイベントに対する処理を追加できます
    }
};

try {
    for (const ev of events) {
        await processEvent(ev);
    }

    console.log('all promises passed');
} catch (error) {
    console.error(error.stack);
}
};



// greeting_follow関数
// 参考↓ profileの中身
// profile: {
//     userId: 'xxxxxxxxxxxx',
//     displayName: 'あなたのLINE表示名',
//     language: 'ja'
//     }
const greeting_follow = async (ev) => {
    const profile = await client.getProfile(ev.source.userId);
    return client.replyMessage(ev.replyToken,{
        "type":"text",
        "text":`${profile.displayName}さん、フォローありがとうございます\uDBC0\uDC04`
    });
 }
 