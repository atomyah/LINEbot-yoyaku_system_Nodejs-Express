const express = require('express');
const app = express();
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 5000
const { Client } = require('pg');


//// グローバル変数 ////
const INITIAL_TREAT = [20,10,40,15,30,15,10];  //施術時間初期値
// 「カット、シャンプー、カラーリンング、ヘッドスパ、ﾏｯｻｰｼﾞ&ﾊﾟｯｸ、眉整え、顔そり」にかかるデフォルトの時間

const MENU = ['カット','シャンプー','カラーリング','ヘッドスパ','マッサージ＆スパ','眉整え','顔そり'];

const WEEK = [ "日", "月", "火", "水", "木", "金", "土" ];
//// グローバル変数ここまで ////



// Heroku Postgres接続コンフィグコード
const connection = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
});
connection.connect();


// CREATE TABLE（顧客データ）テーブル作成．カット、シャンプー、カラーリンング、ヘッドスパの時間は顧客ごとに異なるため顧客データベースの項目に入れ後で変更可能にする．
const create_userTable = {
    text:'CREATE TABLE IF NOT EXISTS users (id SERIAL NOT NULL, line_uid VARCHAR(255), display_name VARCHAR(255), timestamp VARCHAR(255), cuttime SMALLINT, shampootime SMALLINT, colortime SMALLINT, spatime SMALLINT);'
};
connection.query(create_userTable)
   .then(()=>{
       console.log('table users created successfully!!');
   })
   .catch(e=>console.log(e));


// 予約データベース作成．
const create_reservationTable = {
text:'CREATE TABLE IF NOT EXISTS reservations (id SERIAL NOT NULL, line_uid VARCHAR(255), name VARCHAR(100), scheduledate DATE, starttime BIGINT, endtime BIGINT, menu VARCHAR(50));'
};
connection.query(create_reservationTable)
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
    }else if(text === '予約確認'){
        const nextReservation = await checkNextReservation(ev); // nextReservationは配列はcheckNextReservation(ev)から配列として返ってくる．
        const startTimestamp = nextReservation[0].starttime;
        const date = dateConversion(startTimestamp);
        const menu = MENU[parseInt(nextReservation[0].menu)];
        return client.replyMessage(ev.replyToken,{
          "type":"text",
          "text":`次回予約は${date}、${menu}でお取りしてます\uDBC0\uDC22`
        });
    }else if(text === '予約キャンセル'){
      const nextReservation = await checkNextReservation(ev);
      if(nextReservation.length){
        console.log('次回予約があります');
      }else{
        console.log('次回予約なし');
      }
    }else{
        return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":`${profile.displayName}さん、今${text}って言いました？`
        });
    }
}


// 予約確認関数checkNextReservation()
const checkNextReservation = (ev) => {
 return new Promise((resolve,reject)=>{
    const id = ev.source.userId;
    const nowTime = new Date().getTime();

    // $1 は、PostgreSQLのパラメータ化されたクエリ(Parameterized Query)において、プレースホルダーとして使用される記号.
    // line_uid = $1の$1の部分に、実際の値が代入される．代入される値は、valuesプロパティで指定される．
    // 実際に実行されるクエリは以下のようになる。
    // SELECT * FROM reservations WHERE line_uid = 'U559cea57076f1f2383db950ef23125ac' ORDER BY starttime ASC;
    // ${id}の部分は、${}で囲まれた部分、ここではidという変数の値が埋め込まれてる．[]で囲まれていることから配列である．
    // valuesプロパティは、クエリ内のプレースホルダーに実際の値を割り当てるためのもの. values: [`${id},${name}`]など複数指定でき、
    // SELECT文でwhere line_uid = $1 and name = $2など複数のプレースホルダーを使える.
    const selectQuery = {
      text:'SELECT * FROM reservations WHERE line_uid = $1 ORDER BY starttime ASC;',
      values: [`${id}`]
    };

    connection.query(selectQuery)
      .then(res=>{
        if(res.rows.length){  // クエリを実行して返ってきた全予約データはres.rowsに格納．
          const nextReservation = res.rows.filter(targetUser=>{
            return parseInt(targetUser.starttime) >= nowTime; // さらにそのユーザーの現在(nowTime)より未来にある予約データをfiltering.
          });
          console.log('nextReservationは:',nextReservation);  // nextReservationは配列．
          /// コンソール表示結果 → nextReservationは：[{id:1, line_uid:'U559cea57076f1f2383db950ef23125ac', name: 'Atom', scheduledate: 2024-04-01T00:00:00.000Z, '1711929600000', endtime: '1711930800000', menu: '0'}]
          resolve(nextReservation);
        }else{
          resolve([]);    // checkNextReservation()関数を呼び出す側が配列の戻りを期待してるので、nextReservationが無かった場合カラ配列を戻している。
        }
      })
      .catch(e=>console.log(e));
 });
}


// dateConversion()関数．タイムスタンプを日時、時刻の文字列に変換する．
const dateConversion = (timestamp) => {     // timestampはデータベースから取得したものなので文字列型startTimestamp
    const d = new Date(parseInt(timestamp));
    const month = d.getMonth()+1;           // getMonth()メソッドで得られる数値は本来の値から1少ない数なので、+1
    const date = d.getDate();
    const day = d.getDay();
    const hour = ('0' + (d.getHours()+9)).slice(-2);  // d.getHours()+9)が9だった場合9:00となる.1桁だと見栄えが悪いので09:00になるようにしてる．
    const min = ('0' + d.getMinutes()).slice(-2);     // d.getMinutes()が5だった場合、14:5となる．１桁だと見栄え悪いので14:05になるようにしてる．
    return `${month}月${date}日(${WEEK[day]}) ${hour}:${min}`;
}


// handlePostbackEvent関数(menu&xのxをorderMenuに格納しaskData(ev,[選ばれたメニュー])を実行)
////////////////////////////////////////////////////////////////////////////////
// Flexのメニューを選択した時のevの中身
// ev:{
// type: 'postback',
// replyToken: 'xxxxxxxxxxxxxxxxx',
// source: { userId: 'yyyyyyyyyyyyyyyy', type: 'user' },
// timestamp: 1601177107159,
// mode: 'active',
// postback: { data: 'menu&0' }
// }
////////////////////////////////////////////////////////////////////////////////
// 予約希望日のカレンダの日付とOKボタンをクリックしたときのevの中身
// ev: {
//   type: 'postback',
//   replyToken: 'xxxxxxxxxxxxxxxxxx',
//   source: { userId: 'yyyyyyyyyyyyyyyyyy', type: 'user' },
//   timestamp: 1601191757256,
//   mode: 'active',
//   postback: { data: 'date&0', params: {date: '2020-09-30' } }
// }
////////////////////////////////////////////////////////////////////////////////
// 予約希望時間帯とOKボタンをクリックしたときのevの中身
// ev: {
//   type: 'postback',
//   replyToken: 'xxxxxxxxxxxxxxxxxxx',
//   source: { userId: 'yyyyyyyyyyyyy', type: 'user' },
//   timestamp: 1601554070567,
//   mode: 'active',
//   postback: { data: 'time&4&2020-09-30&3' }
//   }
////////////////////////////////////////////////////////////////////////////////
// 「次回予約は・・・でよろしいでしょうか？」の確認で「はい」をクリックした時のevの中身
// ev: {
//   type: 'postback',
//   replyToken: 'xxxxxxxxxxxxxxxxxx',
//   source: { userId: 'yyyyyyyyyyyyyyyyyyy', type: 'user' },
//   timestamp: 1601720974565,
//   mode: 'active',
//   postback: { data: 'yes&4&2020-09-30&10' },
//   }
const handlePostbackEvent = async (ev) => {
  const profile = await client.getProfile(ev.source.userId);
  const data = ev.postback.data;
  const splitData = data.split('&');

  //splitData配列例：[ 'time', '4', '2020-09-30', '3' ] timeは希望時間帯のpostbackだよ、という意味．
  // 4は希望メニューの「ﾏｯｻｰｼﾞ&ﾊﾟｯｸ」のこと、3は予約時間帯１２時台を表す．
  
  if(splitData[0] === 'menu'){
      const orderedMenu = splitData[1];
      askDate(ev,orderedMenu);
  }else if(splitData[0] === 'date'){
      const orderedMenu = splitData[1];
      const selectedDate = ev.postback.params.date;
      askTime(ev, orderedMenu, selectedDate);
  }else if(splitData[0] === 'time'){
      const orderedMenu = splitData[1]; // 4
      const selectedDate = splitData[2]; // 2020-09-30
      const selectedTime = splitData[3]; // 3
      confirmation(ev,orderedMenu,selectedDate,selectedTime);
  }else if(splitData[0] === 'yes'){
    const orderedMenu = splitData[1];
    const selectedDate = splitData[2];
    const selectedTime = splitData[3];
    const startTimestamp = timeConversion(selectedDate,selectedTime);
    console.log('その1');
    const treatTime = await calcTreatTime(ev.source.userId,orderedMenu);
    const endTimestamp = startTimestamp + treatTime*60*1000;  // calcTreatTime関数から帰ってきたtreatTimeは分単位なのでミリ秒に変換.
    console.log('その4');
    console.log('endTime:',endTimestamp);
    const insertQuery = {
      text:'INSERT INTO reservations (line_uid, name, scheduledate, starttime, endtime, menu) VALUES($1,$2,$3,$4,$5,$6);',
      values:[ev.source.userId,profile.displayName,selectedDate,startTimestamp,endTimestamp,orderedMenu]
    };
    connection.query(insertQuery)
    .then(res=>{
      console.log('データ格納成功！');
      client.replyMessage(ev.replyToken,{
        "type":"text",
        "text":"予約が完了しました。"
      });
    })
    .catch(e=>console.log(e));
  }else if(splitData[0] === 'no'){
    // あとで何か入れる
  }
}

/// 施術開始時間を1970年1/1 0時からのミリ秒で取得する
const timeConversion = (date,time) => {
  const selectedTime = 9 + parseInt(time) - 9;  // 開店9時なので9をプラス、new Date( )で勝手に日本標準時間の+9時間分のミリ秒が足されてしまうため、-9としている．
  return new Date(`${date} ${selectedTime}:00`).getTime();
}

/// userIdと選んだメニューから該当するユーザー情報を取り出し（line_uid = $1）、ユーザが存在すれば（if(res.rows.length)）
/// そのカット、シャンプー、カラー、スパ、INITIAL_TREAT[4]～[6]（ﾏｯｻｰｼﾞ&ﾊﾟｯｸ、眉整え、顔そり）の各施術時間をtreatArray配列
/// に格納．メニュー番号は文字列を通知型にし（parseInt(menu)）、treatArray[]のインデックスとして使用できるようにする．
/// 選んだメニューはひとつだけなので、それにかかる時間（treatArray[menuNumber]）をtreatTimeに格納し返す（分単位）．
const calcTreatTime = (id,menu) => {
  return new Promise((resolve,reject)=>{
    console.log('その2');
    const selectQuery = {
      text: 'SELECT * FROM users WHERE line_uid = $1;',
      values: [`${id}`]
    };
    connection.query(selectQuery)
    .then(res=>{
      console.log('その3');
      if(res.rows.length){
        const info = res.rows[0];
        const treatArray = [info.cuttime,info.shampootime,info.colortime,info.spatime,INITIAL_TREAT[4],INITIAL_TREAT[5],INITIAL_TREAT[6]];
        const menuNumber = parseInt(menu);
        const treatTime = treatArray[menuNumber];
        resolve(treatTime);
      }else{
        console.log('LINE IDに一致するユーザーが見つかりません。');
        return;
      }
    })
    .catch(e=>console.log(e));
  });
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


// LINE Flex Message（確認（はい、いいえ））を表示するconfirmation関数
// handlePostbackEvent()関数の中のconfirmation(ev,orderedMenu,selectedDate,selectedTime);
const confirmation = (ev,menu,date,time) => {
  const splitDate = date.split('-');
  const selectedTime = 9 + parseInt(time); // timeは文字列なのでparseIntで数値型に．0->9に9時->19時を割り当ててるので（例：3は１２時）9を足している．
  
  return client.replyMessage(ev.replyToken,{
    "type":"flex",
    "altText":"menuSelect",
    "contents":
    {
      "type": "bubble",
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": `次回予約は${splitDate[1]}月${splitDate[2]}日 ${selectedTime}時〜でよろしいでしょうか？`,
            "wrap": true
          },
          {
            "type": "separator"
          }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "horizontal",
        "contents": [
          {
            "type": "button",
            "action": {
              "type": "postback",
              "label": "はい",
              "data": `yes&${menu}&${date}&${time}`
            }
          },
          {
            "type": "button",
            "action": {
              "type": "postback",
              "label": "いいえ",
              "data": `no&${menu}&${date}&${time}`
            }
          }
        ]
      }
    }
  });
 }
