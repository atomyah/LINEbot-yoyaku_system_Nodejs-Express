const express = require('express');
const app = express();
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 5000
const { Client } = require('pg');


const INITIAL_TREAT = [20,10,40,15,30,15,10];  //施術時間初期値


// Heroku Postgres接続コンフィグコード
const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
});
connection.connect();


// CREATE TABLE（顧客データ）テーブル作成
const create_userTable = {
    text:'CREATE TABLE IF NOT EXISTS users (id SERIAL NOT NULL, line_uid VARCHAR(255), display_name VARCHAR(255), timestamp VARCHAR(255), cuttime SMALLINT, shampootime SMALLINT, colortime SMALLINT, spatime SMALLINT);'
};
connection.query(create_userTable)
   .then(()=>{
       console.log('table users created successfully!!');
   })
   .catch(e=>console.log(e));


    

// LINE Messaging APIコンフィグ
const config = {
   channelAccessToken:process.env.ACCESS_TOKEN,
   channelSecret:process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

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
            case 'message':
                await handleMessageEvent(ev);
                break;
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

    // CREATE TABLE（顧客データ）テーブルデータ挿入
    const table_insert = {
        // VALUES($1,$2,$3,$4,$5,$6,$7) は、SQLのプリペアドステートメントで使用されるパラメーター. $1がline_uid, $2がtimestampを表す.SQLインジェクション攻撃を防ぐためだけに必要
        text:'INSERT INTO users (line_uid,display_name,timestamp,cuttime,shampootime,colortime,spatime) VALUES($1,$2,$3,$4,$5,$6,$7);',
        values:[ev.source.userId,profile.displayName,ev.timestamp,INITIAL_TREAT[0],INITIAL_TREAT[1],INITIAL_TREAT[2],INITIAL_TREAT[3]]
      };
      await connection.query(table_insert)
        .then(()=>{
           console.log('insert successfully!!')
         })
        .catch(e=>console.log(e));


    return client.replyMessage(ev.replyToken,{
        "type":"text",
        "text":`${profile.displayName}さん、フォローありがとうございます\uDBC0\uDC04`
    });

 }
 


// handleMessageEvent関数（オウム返し）
// 参考↓ evの中身
// ev: {
//     type: 'message',
//     replyToken: 'xxxxxxxxxxxxxxx',
//     source: { userId: 'yyyyyyyyyyyyyy', type: 'user' },
//     timestamp: 1601102227933,
//     mode: 'active',
//     message: { type: 'text', id: 'zzzzzzzzzzzz', text: 'こんにちは' }
//     }
const handleMessageEvent = async (ev) => {
    const profile = await client.getProfile(ev.source.userId);
    const text = (ev.message.type === 'text') ? ev.message.text : '';

    if(text === '予約する'){
        return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":"かしこまりました。次回予約ですね。メニューは・・・"
        });
    }else{
        return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":`${profile.displayName}さん、今${text}って言いました？`
        });
    }
}