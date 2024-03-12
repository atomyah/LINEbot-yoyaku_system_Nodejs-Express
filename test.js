const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = 3000;

// PostgreSQL接続情報
const pool = new Pool({
  user: 'postgres', // データベースユーザー
  host: 'LINEbot-postgres', // Postgresコンテナのホスト名
  database: 'app_db', // データベース名
  password: 'password', // データベースパスワード
  port: 5432, // データベースのポート
});

// ユーザーテーブルからデータを取得
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});