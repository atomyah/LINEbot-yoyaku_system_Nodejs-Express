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

// Herokuの本番URL：https://linebot-yoyaku-a5f58ab954a7.herokuapp.comに/hookスラグを追加したもの
// https://linebot-yoyaku-a5f58ab954a7.herokuapp.com/hook/ を
// LINE Messaging APIのWebhook URL欄に設定．
app
   .post('/hook',line.middleware(config),(req,res)=> lineBot(req,res))
   .listen(PORT,()=>console.log(`Listening on ${PORT}`));


// lineBot関数(mainとなる関数.evのtypeによって振り分け)
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
            case 'postback':
                await handlePostbackEvent(ev);
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



// greeting_follow関数．フォローされたら挨拶を返す．
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
 


// handleMessageEvent関数（'予約する'のmessageだった場合Flex Messageを表示．その他の場合オウム返し）
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
        orderChoice(ev);
    }else{
        return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":`${profile.displayName}さん、今${text}って言いました？`
        });
    }
}

// handlePostbackEvent関数(menu&xのxをorderMenuに格納しaskData(ev,[選ばれたメニュー])を実行)
// Flexのメニューを選択した時のevの中身
// ev:{
// type: 'postback',
// replyToken: 'xxxxxxxxxxxxxxxxx',
// source: { userId: 'yyyyyyyyyyyyyyyy', type: 'user' },
// timestamp: 1601177107159,
// mode: 'active',
// postback: { data: 'menu&0' }
// }
// 予約希望日のカレンダの日付とOKボタンをクリックしたときのevの中身
// ev: {
//   type: 'postback',
//   replyToken: 'xxxxxxxxxxxxxxxxxx',
//   source: { userId: 'yyyyyyyyyyyyyyyyyy', type: 'user' },
//   timestamp: 1601191757256,
//   mode: 'active',
//   postback: { data: 'date&0', params: {date: '2020-09-30' } }
// }
const handlePostbackEvent = async (ev) => {
  const profile = await client.getProfile(ev.source.userId);
  const data = ev.postback.data;
  const splitData = data.split('&');
  
  if(splitData[0] === 'menu'){
      const orderedMenu = splitData[1];
      askDate(ev,orderedMenu);
  }else if(splitData[0] === 'date'){
      const orderedMenu = splitData[1];
      const selectedDate = ev.postback.params.date;
      askTime(ev, orderedMenu, selectedDate);
  }
}



// LINE Flex Message（予約の起点画面）を表示する関数
const orderChoice = (ev) => {
  return client.replyMessage(ev.replyToken,{
      "type":"flex",
      "altText":"menuSelect",
      "contents":
      {
          "type": "bubble",
          "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "メニューを選択して下さい",
                "align": "center",
                "size": "lg"
              }
            ]
          },
          "hero": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "(１つのみ選択可能です)",
                "size": "md",
                "align": "center"
              },
              {
                "type": "separator"
              }
            ]
          },
          "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "カット",
                      "data": "menu&0"
                    },
                    "style": "primary",
                    "color": "#999999",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "シャンプー",
                      "data": "menu&1"
                    },
                    "style": "primary",
                    "color": "#999999",
                    "margin": "md"
                  }
                ]
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "ｶﾗｰﾘﾝｸﾞ",
                      "data": "menu&2"
                    },
                    "margin": "md",
                    "style": "primary",
                    "color": "#999999"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "ヘッドスパ",
                      "data": "menu&3"
                    },
                    "margin": "md",
                    "style": "primary",
                    "color": "#999999"
                  }
                ],
                "margin": "md"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "ﾏｯｻｰｼﾞ&ﾊﾟｯｸ",
                      "data": "menu&4"
                    },
                    "margin": "md",
                    "style": "primary",
                    "color": "#999999"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "顔そり",
                      "data": "menu&5"
                    },
                    "style": "primary",
                    "color": "#999999",
                    "margin": "md"
                  }
                ],
                "margin": "md"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "眉整え",
                      "data": "menu&6"
                    },
                    "margin": "md",
                    "style": "primary",
                    "color": "#999999"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "選択終了",
                      "data": "end"
                    },
                    "margin": "md",
                    "style": "primary",
                    "color": "#0000ff"
                  }
                ],
                "margin": "md"
              },
              {
                "type": "separator"
              }
            ]
          },
          "footer": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "button",
                "action": {
                  "type": "postback",
                  "label": "キャンセル",
                  "data": "cancel"
                }
              }
            ]
          }
        }
  });
}

// LINE Flex Message（予約希望日を聞く）を表示するaskDate関数
const askDate = (ev,orderedMenu) => {
  return client.replyMessage(ev.replyToken,{
      "type":"flex",
      "altText":"予約日選択",
      "contents":
      {
        "type": "bubble",
        "body": {
          "type": "box",
          "layout": "vertical",
          "contents": [
            {
              "type": "text",
              "text": "予約希望日を選択して下さい",
              "align": "center"
            }
          ]
        },
        "footer": {
          "type": "box",
          "layout": "vertical",
          "contents": [
            {
              "type": "button",
              "action": {
                "type": "datetimepicker",
                "label": "希望日を選択する",
                "data": `date&${orderedMenu}`,
                "mode": "date"
              }
            }
          ]
        }
      }
  });
}

// LINE Flex Message（予約希望時間を聞く）を表示するaskTime関数
const askTime = (ev,orderedMenu,selectedDate) => {
  return client.replyMessage(ev.replyToken,{
      "type":"flex",
      "altText":"予約日選択",
      "contents":
      {
          "type": "bubble",
          "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "text",
                "text": "ご希望の時間帯を選択してください（緑=予約可能です）",
                "wrap": true,
                "size": "lg"
              },
              {
                "type": "separator"
              }
            ]
          },
          "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "9時-",
                      "data":`time&${orderedMenu}&${selectedDate}&0`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "10時-",
                      "data": `time&${orderedMenu}&${selectedDate}&1`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "11時-",
                      "data": `time&${orderedMenu}&${selectedDate}&2`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  }
                ]
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "12時-",
                      "data": `time&${orderedMenu}&${selectedDate}&3`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "13時-",
                      "data": `time&${orderedMenu}&${selectedDate}&4`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "14時-",
                      "data": `time&${orderedMenu}&${selectedDate}&5`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  }
                ],
                "margin": "md"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "15時-",
                      "data": `time&${orderedMenu}&${selectedDate}&6`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "16時-",
                      "data": `time&${orderedMenu}&${selectedDate}&7`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "17時-",
                      "data": `time&${orderedMenu}&${selectedDate}&8`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  }
                ],
                "margin": "md"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "18時-",
                      "data": `time&${orderedMenu}&${selectedDate}&9`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "19時-",
                      "data": `time&${orderedMenu}&${selectedDate}&10`
                    },
                    "style": "primary",
                    "color": "#00AA00",
                    "margin": "md"
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "終了",
                      "data": "end"
                    },
                    "style": "primary",
                    "color": "#0000ff",
                    "margin": "md"
                  }
                ],
                "margin": "md"
              }
            ]
          }
        }       
  });
}