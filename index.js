const express = require('express');
const app = express();
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 5000
const { Client } = require('pg');


//// グローバル変数 //// 
/// ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓　メニューによってかかる時間を可変にしないので不必要に　↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
//const INITIAL_TREAT = [20,10,40,15,30,15,10];  //施術時間初期値
// 「カット、シャンプー、カラーリンング、ヘッドスパ、ﾏｯｻｰｼﾞ&ﾊﾟｯｸ、眉整え、顔そり」にかかるデフォルトの時間

// ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓　とはいうもののメニューごとの時間を一応設定　↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
const INITIAL_TREAT = [60,60,120];  //施術時間値
//「'ボディトークセッション','ホリスティックコンディション','パーソナルビルドアップ'」にかかるデフォルトの時間

const MENU = ['ボディトークセッション','ホリスティックコンディション','パーソナルビルドアップ'];

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


// 顧客テーブル（users）作成．id, line_uid, display_name, timestamp
const create_userTable = {
    text:'CREATE TABLE IF NOT EXISTS users (id SERIAL NOT NULL, line_uid VARCHAR(255), display_name VARCHAR(255), timestamp VARCHAR(255));'
};
connection.query(create_userTable)
   .then(()=>{
       console.log('usersテーブルが作成されました!!');
   })
   .catch(e=>console.log(e));


// 予約テーブル(reservations)作成．
const create_reservationTable = {
text:'CREATE TABLE IF NOT EXISTS reservations (id SERIAL NOT NULL, line_uid VARCHAR(255), name VARCHAR(100), scheduledate DATE, starttime BIGINT, endtime BIGINT, menu VARCHAR(50));'
};
connection.query(create_reservationTable)
.then(()=>{
    console.log('reservationsテーブルが作成されました!!');
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
            case 'unfollow':
              await handleUnfollowEvent(ev);
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
        // VALUES($1,$2,$3) は、SQLのプリペアドステートメントで使用されるパラメーター. $1がline_uid, $2がtimestampを表す.SQLインジェクション攻撃を防ぐためだけに必要
        // cuttime,shampootime,color,spaにかかる可変時間は削除したのでline_uid,display_name,timestampの３つだけ．
        text:'INSERT INTO users (line_uid,display_name,timestamp) VALUES($1,$2,$3);',
        values:[ev.source.userId,profile.displayName,ev.timestamp]  // timestampはイベント発生時のミリ秒．ここではフォローされた時．
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
 

// ユーザーがボットをブロックまたは削除した際に、対応するユーザー情報をusersテーブルから削除.
const handleUnfollowEvent = async (ev) => {
  const deleteQuery = {
      text: 'DELETE FROM users WHERE line_uid = $1',
      values: [ev.source.userId]
  };

  try {
      await connection.query(deleteQuery);
      console.log(`User ${ev.source.userId} は削除されました.`);
  } catch (error) {
      console.error('Error deleting user:', error);
  }
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
        // orderChoice(ev)からpostbackの値（menu&0,menu&1,menu&2のどれか）を取得し、handlePostbackEvent()へ．
    }else if(text === '予約確認'){
        const nextReservation = await checkNextReservation(ev); // nextReservationは配列はcheckNextReservation(ev)から配列として返ってくる．
        if(!nextReservation){
          return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":`予約は入っておりません\uDBC0\uDC22`
          });
        }
        const startTimestamp = nextReservation[0].starttime;
        const date = dateConversion(startTimestamp);
        const menu = MENU[parseInt(nextReservation[0].menu)];
        return client.replyMessage(ev.replyToken,{
          "type":"text",
          "text":`次回予約は${date}、${menu}でお取りしてます\uDBC0\uDC22`
        });
    }else if(text === '予約キャンセル'){
      const nextReservation = await checkNextReservation(ev);
      // nextReservationの中身：[{id:1, line_uid:'U559cea57076f1f2383db950ef23125ac', name:'Atom', scheduledate:2024-04-01T00:00:00.000Z, starttime:'1711929600000', endtime:'1711930800000', menu:'0'}]
      // 47行目参考↑
      if(nextReservation.length){
          const startTimestamp = parseInt(nextReservation[0].starttime);
          const menu = MENU[parseInt(nextReservation[0].menu)];
          const date = dateConversion(startTimestamp);
          const id = parseInt(nextReservation[0].id); // このidは予約テーブルのid. 
          return client.replyMessage(ev.replyToken,{
            "type":"flex",
            "altText": "cancel message",
            "contents":
            {
              "type": "bubble",
              "body": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                  {
                    "type": "text",
                    "text": `次回の予約は${date}から、${menu}でお取りしています。キャンセルなさいますか？`,
                    "align": "center",
                    "wrap": true
                  }
                ]
              },
              "footer": {
                "type": "box",
                "layout": "vertical",
                "contents": [
                  {
                    "type": "button",
                    "style": "link",
                    "height": "sm",
                    "action": {
                      "type": "postback",
                      "label": "予約をキャンセルする",
                      "data": `delete&${id}`
                    }
                  },
                  {
                    "type": "button",
                    "action": {
                      "type": "postback",
                      "label": "キャンセルを取りやめる",
                      "data": "delete&stopcancel"
                    },
                    "height": "sm",
                    "style": "link"
                  }
                ]
              }
            }
          });
      }else{
        return client.replyMessage(ev.replyToken,{
          "type":"text",
          "text":"次回予約は入っておりません。"
        });
      }
    }else{
        return client.replyMessage(ev.replyToken,{
            "type":"text",
            "text":`${profile.displayName}様、「${text}」は予約に関係のない文章です`
        });
    }
}


// 予約確認関数checkNextReservation()
const checkNextReservation = (ev) => {
 return new Promise((resolve,reject)=>{
    const id = ev.source.userId;
    const nowTime = new Date().getTime();

    const selectQuery = {
      text: 'SELECT * FROM reservations WHERE line_uid = $1 AND starttime > $2 ORDER BY starttime ASC;',
      values: [`${id}`, nowTime]
    };

    connection.query(selectQuery)
      .then(res=>{
        if(res.rows.length){  // クエリを実行して返ってきた予約データはres.rowsに格納．
          const nextReservation = res.rows.filter(targetUser=>{
            return parseInt(targetUser.starttime) >= nowTime; // さらにそのユーザーの、現在(nowTime)より未来にある予約データをfilteringで抽出.
          });
          console.log('nextReservationは:',nextReservation);  // nextReservationは配列．
          /// コンソール表示結果 → nextReservationは：[{id:1, line_uid:'U559cea57076f1f2383db950ef23125ac', name: 'Atom', scheduledate: 2024-04-01T00:00:00.000Z, starttime: '1711929600000', endtime: '1711930800000', menu: '0'}]
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
  

  // 予約をすでに入れているかの確認．「一人につき予約は一つ」制限．
  // ただし「予約キャンセル」フェーズ（splitData[0] === 'delete'）の場合は462行目の処理へ飛ばさなければならない．
  const nextReservation = await checkNextReservation(ev);
  if (nextReservation.length && splitData[0] !== 'delete') {
    // ユーザーが既に予約を持っている場合の処理
    return client.replyMessage(ev.replyToken, {
      type: "text",
      text: "すでに予約を入れてます。変更したい場合は今の予約を一旦「キャンセル」頂き、あらためて新規に予約して下さい。"
    });
  } else {

      if(splitData[0] === 'menu'){
          const orderedMenu = splitData[1]; // splitData[1]には,0,1,2のいずれかの文字列が入ってる．
          askDate(ev,orderedMenu);
      }else if(splitData[0] === 'date'){ // askDate()がpostbackデータ'date&${orderedMenu}'を返してくる．それを元に...
          const orderedMenu = splitData[1];
          const selectedDate = ev.postback.params.date; // ev.postback.params.dateには '2020-09-30' などといった文字列が入ってる．
          askTime(ev, orderedMenu, selectedDate); // askTime(ev, 0, '2020-09-30')等とaskTime()を実行する．
      }else if(splitData[0] === 'time'){ //askTime()がpostbackデータ`time&${orderedMenu}&${selectedDate}&0`を返してくる．それを元に...
          const orderedMenu = splitData[1]; // 0
          const selectedDate = splitData[2]; // 2020-09-30
          const selectedTime = splitData[3]; // 3 -> 0~10まである. 0が９時の枠で10が１９時の枠を表す．

          // 予約済み時間枠を選択の場合は「予約が入っております」メッセージを表示．そうでなければconfirmation()を表示する．
          const reservedTimeSlots = await getReservedTimes(selectedDate) // reservedTimeSlotsを返す．例：Set(4) { 3, 7,8, 10 }．１２時、１６時（２時間枠）、１９時
          const selectedTimeNum = parseInt(selectedTime); // 数値型にしないとreservedTimeSlots.has('数値')が機能しない．
        
          // orderedMenuが2（パーソナルフィッティング）の場合、120分（2時間）の施術時間があるので、終了時間もチェックする
          let endTime = selectedTimeNum;
          if (orderedMenu === '2') {
              endTime += 1; // 1つ後の時間帯も予約不可とする
          }

          // 予約が可能かどうかをチェック．orderedMenuが2の時以外はfor文は一周しかしない．
          let isReserved = false;
          for (let i = selectedTimeNum; i <= endTime; i++) {
              if (reservedTimeSlots.has(i)) {
                  isReserved = true;
                  break;
              }
          }         
    
          // const isReserved = reservedTimeSlots.has(selectedTimeNum);
          if(isReserved){
            return client.replyMessage(ev.replyToken,{
              "type":"text",
              "text":"予約が入っております。別の時間枠を選択下さい。"
            });
          }else {
            confirmation(ev,orderedMenu,selectedDate,selectedTime); // confirmation(ev, 0, '2020-09-30', 0)等となる．
          }
      }else if(splitData[0] === 'yes'){   // confirmation()からpostbackデータ`yes&${menu}&${date}&${time}`が返ってくる．例えば`yes&0&2020-09-30&0`のような形．
        const orderedMenu = splitData[1]; // 0 (ボディトークセッション)
        const selectedDate = splitData[2];  // 2020-09-30
        const selectedTime = splitData[3];  // 0 （９時枠）
        const startTimestamp = timeConversion(selectedDate,selectedTime); // timeConversion('2020-09-30', 0) 1970-01-01からのミリ秒で施術開始時間を取得．
        console.log('その1');
        const treatTime = await calcTreatTime(ev.source.userId,orderedMenu); // calcTreatTime('U559cea57076f1f2383db950ef23125ac', 0)とか
        const endTimestamp = startTimestamp + treatTime*60*1000;  // calcTreatTime関数から返ってきたtreatTime(400行目resolve(treatTime)で返ってくる)は分単位なのでミリ秒に変換.
        console.log('その4');
        console.log('endTime:',endTimestamp);
        const insertQuery = { // reservationテーブル：(id SERIAL NOT NULL, line_uid VARCHAR(255), name VARCHAR(100), scheduledate DATE, starttime BIGINT, endtime BIGINT, menu VARCHAR(50))
          text:'INSERT INTO reservations (line_uid, name, scheduledate, starttime, endtime, menu) VALUES($1,$2,$3,$4,$5,$6);',
          values:[ev.source.userId,profile.displayName,selectedDate,startTimestamp,endTimestamp,orderedMenu]
        };
          ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
          //////// 二人以上同時予約プロセス進行によるダブルブッキングを避けるため、テーブルにINSERTの前にもう一度予約が埋まっていないか再度確認する /////////
          const reservedTimeSlots = await getReservedTimes(selectedDate);
          const selectedTimeNum = parseInt(selectedTime);
          
          let endTime = selectedTimeNum;
          if (orderedMenu === '2') {
              endTime += 1;
          }
          
          let isReserved = false;
          for (let i = selectedTimeNum; i <= endTime; i++) {
              if (reservedTimeSlots.has(i)) {
                  isReserved = true;
                  break;
              }
          }
          
          if (isReserved) {
              return client.replyMessage(ev.replyToken, {
                  "type": "text",
                  "text": "先約が入ってしまいました。別の時間枠を選択下さい。"
              });
          } else {
          /// ここまで ///
          ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
          connection.query(insertQuery)
          .then(res=>{
            console.log('データ格納成功！');
            client.replyMessage(ev.replyToken,{
              "type":"text",
              "text":"予約が完了しました。"
            });
          })
          .catch(err => {
            console.error('データ格納失敗:', err);
            client.replyMessage(ev.replyToken, {
                "type": "text",
                "text": "予約の処理中にエラーが発生しました。再度お試しください。"
            });
          });
        }
      }else if(splitData[0] === 'delete' && splitData[1] !== 'stopcancel'){ // handleMessageEvent()のif(text="予約キャンセル"){checkNextReservation(ev)}からのpostbackデータから来ている. `delete&${id}`
        const id = parseInt(splitData[1]); // handleMessageEvent()の'予約キャンセル'の場合のFlex messageの"data": `delete&${id}`から来てる&でスプリットした二つ目はid値
        const deleteQuery = {
          text:'DELETE FROM reservations WHERE id = $1;',
          values:[`${id}`]
        };
        connection.query(deleteQuery)
          .then(res=>{
            console.log('予約キャンセル成功');
            client.replyMessage(ev.replyToken,{
              "type":"text",
              "text":"予約をキャンセルしました。"
            });
          })
          .catch(e=>console.log(e));
          // "キャンセルを取りやめる"をクリックした時のPostbackデータは、"delete&stopcancel"
      }else if(splitData[0] === 'delete' && splitData[1] === 'stopcancel'){
            return client.replyMessage(ev.replyToken,{
              "type":"text",
              "text":"予約キャンセルを中断しました。"
            });
      }else if(splitData[0] === 'cancel' || splitData[0] === 'no'|| splitData[0] === 'end'){
        // orderChoice()で「選択終了」ボタンのPostbackデータがcancel, confirmation()の「いいえ」のPostbackデータがno, askTimeの「中止」ボタンがend
        return client.replyMessage(ev.replyToken,{
          "type":"text",
          "text":"予約受付を中断します。またのご連絡をお待ちしております。"
        });
      }
      
   }
}

/// 施術開始時間を1970年1/1 0時からのミリ秒で取得する.
// timeConversion('2020-09-30', 0)
const timeConversion = (date,time) => {
  const selectedTime = 9 + parseInt(time) - 9;  // 開店9時なので9をプラス、new Date( )で勝手に日本標準時間の+9時間分のミリ秒が足されてしまうため、-9としている．
  return new Date(`${date} ${selectedTime}:00`).getTime();
}

// calcTreatTime('U559cea57076f1f2383db950ef23125ac', 0)とかの形で実行される．
// const INITIAL_TREAT = [60,60,120]; 施術時間値.前からボディトーク60分、ホリスティック60分、マンツーフィット90分．
// menuには0,1,2のどれかが入っている．
const calcTreatTime = (id,menu) => {
  return new Promise((resolve, reject)=>{
    console.log('その2');
    const menuNumber = parseInt(menu); // 0,1,2は文字列なのでparseIntで数値に．
    const treatTime = INITIAL_TREAT[menuNumber] // const INITIAL_TREAT = [60,60,120]からmenuNumberをインデックスとしてmenuごとの施術時間を取り出す（分単位）
    
    console.log('その3');
    resolve(treatTime);
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
                    "label": "ﾎﾞﾃﾞｨﾄｰｸｾｯｼｮﾝ(60分)",
                    "data": "menu&0"
                  },
                  "style": "primary",
                  "color": "#0000ff",
                  "margin": "sm"
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
                    "label": "ﾎﾘｽﾃｨｯｸｺﾝﾃﾞｨｼｮﾝ(60分)",
                    "data": "menu&1"
                  },
                  "margin": "sm",
                  "style": "primary",
                  "color": "#0000ff"
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
                    "label": "ﾊﾟｰｿﾅﾙﾋﾞﾙﾃﾞｨﾝｸﾞ(100分)",
                    "data": "menu&2"
                  },
                  "margin": "sm",
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

// LINE Flex Message（予約希望日を聞く）を表示するaskDate関数. askDate(ev,orderedMenu)のorderedMenuには1,2,3のいずれかの文字列が入ってる．
const now = new Date();
const minDate = now.toISOString().slice(0, 10); // 現在日時を"YYYY-MM-DD"の形式で取得

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
                "mode": "date",
                "min": `${minDate}`
              }
            }
          ]
        }
      }
  });
}

//////////////////
/// getReservedTimes関数.指定された日付における予約済みの時間帯を取得するための関数. askTimeの中で使う（getReservedTimes(selectedDate)のように）
const getReservedTimes = async (selectedDate) => {
  const selectQuery = {
      text: 'SELECT starttime, endtime, menu FROM reservations WHERE scheduledate = $1;',
      values: [selectedDate],
  };

  try {
      const res = await connection.query(selectQuery);
      const reservedTimeSlots = new Set(); // 予約済みの時間帯を格納するためのSet

      res.rows.forEach((reservation) => {
          const startTime = parseInt(reservation.starttime);
          const endTime = parseInt(reservation.endtime);
          const menuNum = parseInt(reservation.menu)
          const treatmentTime = INITIAL_TREAT[menuNum] * 60 * 1000; // 施術時間をミリ秒単位で取得

          // 予約の時間帯を取得し、施術時間に合わせて時間枠を追加する
          for (let time = startTime; time < endTime; time += (60 * 60 * 1000)) {
              reservedTimeSlots.add(Math.floor((time % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)));
          }
      });
      console.log("▲reservedTimeSlotsは（getReservedTimesの中）、", reservedTimeSlots); // 出力→Set(4) { 3, 7,8, 10 }．１２時、１６時（２時間枠）、１９時
      return reservedTimeSlots;
  } catch (error) {
      console.error('Error fetching reserved times:', error);
      return new Set(); // エラー時は空のSetを返す
  }
};


// LINE Flex Message（予約希望時間を聞く）を表示するaskTime関数．askTime(ev, 0, '2020-09-30')のような形で呼ばれる．
const askTime = async (ev, orderedMenu, selectedDate) => {
  
  try {
      const reservedTimeSlots = await getReservedTimes(selectedDate);

      console.log("▲reservedTimeSlotsは（askTimeの中）、", reservedTimeSlots);  // 出力→Set(4) { 3, 7,8, 10 }．１２時、１６時（２時間枠）、１９時
    
      const buttons = [];
      for (let i = 0; i < 11; i++) {
          const hour = i + 9;
          const timeSlot = `${hour}時-`;

           // ボタンが押されたときに予約可能かどうかを確認
          const isReserved = reservedTimeSlots.has(i);  // isReservedには`i=0`:`false`が格納される？
          const buttonStyle = isReserved ? 'secondary' : 'primary';
          const buttonColor = isReserved ? '#AA0000' : '#00AA00';

          const button = {
            type: 'button',
            action: {
              type: 'postback',
              label: timeSlot,
              data: `time&${orderedMenu}&${selectedDate}&${i}`,
            },
            style: buttonStyle,
            color: buttonColor,
            margin: 'md',
            //disabled: buttonDisabled, // 予約済みの場合はボタンを無効にする
          };
          buttons.push(button);
      }

      buttons.push({
          type: 'button',
          action: {
              type: 'postback',
              label: '中止',
              data: 'end',
          },
          style: 'primary',
          color: '#999999',
          margin: 'md',
      });

      return client.replyMessage(ev.replyToken, {
          type: 'flex',
          altText: '予約日選択',
          contents: {
              type: 'bubble',
              header: {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                      {
                          type: 'text',
                          text: 'ご希望の時間帯を選択してください（緑=予約可能,、赤=予約不可）',
                          wrap: true,
                          size: 'md',
                      },
                      {
                          type: 'separator',
                      },
                  ],
              },
              body: {
                  type: 'box',
                  layout: 'vertical',
                  contents: [
                      {
                          type: 'box',
                          layout: 'vertical',
                          contents: buttons,
                      },
                  ],
              },
          },
      });
  } catch {
    console.error('Error fetching reserved times', error);
  }
};


// LINE Flex Message（確認（はい、いいえ））を表示するconfirmation関数
// handlePostbackEvent()関数の中で使う↓
// confirmation(ev,orderedMenu,selectedDate,selectedTime) → confirmation(ev, 0, '2020-09-30', 0)のような形．
const confirmation = (ev,menu,date,time) => {
  const splitDate = date.split('-'); // '2020-09-30'を2020と09と30に分けてsplitDate配列に格納．
  const selectedTime = 9 + parseInt(time); // timeは文字列なのでparseIntで数値型に．0->9に9時->19時を割り当ててるので（例：3は１２時枠）9を足している．
  
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
