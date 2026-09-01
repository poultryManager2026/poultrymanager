const express=require('express'),path=require('path'),jwt=require('jsonwebtoken'),bcrypt=require('bcryptjs'),Database=require('better-sqlite3');

const app=express(),db=new Database('poultry.db'),SECRET=process.env.JWT_SECRET||'change-this-secret';

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT,email TEXT UNIQUE,password TEXT,
 role TEXT DEFAULT 'worker',active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS batches(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT,start_date TEXT,chicks INTEGER,
 chick_rate REAL,sale_rate REAL,
 status TEXT DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS daily(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 batch_id INTEGER,date TEXT,
 feed_kg REAL DEFAULT 0,
 dead INTEGER DEFAULT 0,
 weight_kg REAL DEFAULT 0,
 medicine REAL DEFAULT 0,
 other REAL DEFAULT 0,
 notes TEXT,
 user_id INTEGER
);
`);

if(!db.prepare('SELECT id FROM users WHERE role="owner"').get()){
 db.prepare(
  'INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)'
 ).run(
  'Owner',
  'owner@poultry.local',
  bcrypt.hashSync('Owner@123',10),
  'owner'
 );
}

function auth(req,res,next){
 try{
  req.user=jwt.verify(
   (req.headers.authorization||'').replace('Bearer ',''),
   SECRET
  );
  next();
 }catch(e){
  res.status(401).json({error:'Login required'});
 }
}

function owner(req,res,next){
 if(req.user.role!=='owner')
  return res.status(403).json({error:'Owner only'});
 next();
}

app.post('/api/login',(req,res)=>{
 let u=db.prepare(
  'SELECT * FROM users WHERE email=? AND active=1'
 ).get(req.body.email);

 if(!u || !bcrypt.compareSync(req.body.password,u.password))
  return res.status(401).json({error:'Invalid login'});

 res.json({
  token:jwt.sign(
   {
    id:u.id,
    name:u.name,
    email:u.email,
    role:u.role
   },
   SECRET,
   {expiresIn:'7d'}
  )
 });
});

app.get('/api/me',auth,(req,res)=>res.json(req.user));

app.get('/api/users',auth,owner,(req,res)=>{
 res.json(
  db.prepare(
   'SELECT id,name,email,role,active FROM users ORDER BY id DESC'
  ).all()
 );
});

app.post('/api/users',auth,owner,(req,res)=>{
 try{
  let r=req.body;
  let x=db.prepare(
   'INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)'
  ).run(
   r.name,
   r.email,
   bcrypt.hashSync(r.password,10),
   r.role||'worker'
  );
  res.json({id:x.lastInsertRowid});
 }catch(e){
  res.status(400).json({error:'Email already exists'});
 }
});

app.patch('/api/users/:id',auth,owner,(req,res)=>{
 let r=req.body;

 db.prepare(
  'UPDATE users SET active=COALESCE(?,active),role=COALESCE(?,role) WHERE id=?'
 ).run(
  r.active,
  r.role,
  req.params.id
 );

 res.json({ok:true});
});

app.get('/api/batches',auth,(req,res)=>{
 res.json(
  db.prepare(
   'SELECT * FROM batches ORDER BY id DESC'
  ).all()
 );
});

app.post('/api/batches',auth,(req,res)=>{
 let r=req.body;

 let x=db.prepare(
  'INSERT INTO batches(name,start_date,chicks,chick_rate,sale_rate) VALUES(?,?,?,?,?)'
 ).run(
  r.name,
  r.start_date,
  r.chicks,
  r.chick_rate||0,
  r.sale_rate||0
 );

 res.json({id:x.lastInsertRowid});
});

/* SAVE DAILY ENTRY */
app.post('/api/daily',auth,(req,res)=>{
 let r=req.body;

 let x=db.prepare(`
  INSERT INTO daily(
   batch_id,date,feed_kg,dead,weight_kg,
   medicine,other,notes,user_id
  )
  VALUES(?,?,?,?,?,?,?,?,?)
 `).run(
  r.batch_id,
  r.date,
  r.feed_kg||0,
  r.dead||0,
  r.weight_kg||0,
  r.medicine||0,
  r.other||0,
  r.notes||'',
  req.user.id
 );

 res.json({
  ok:true,
  id:x.lastInsertRowid
 });
});

/* DAILY HISTORY */
app.get('/api/daily/:batch_id',auth,(req,res)=>{
 let rows=db.prepare(`
  SELECT
   id,batch_id,date,feed_kg,dead,
   weight_kg,medicine,other,notes
  FROM daily
  WHERE batch_id=?
  ORDER BY date DESC,id DESC
 `).all(req.params.batch_id);

 res.json(rows);
});

/* EDIT DAILY ENTRY */
app.patch('/api/daily/:id',auth,(req,res)=>{
 let r=req.body;

 let existing=db.prepare(
  'SELECT id FROM daily WHERE id=?'
 ).get(req.params.id);

 if(!existing)
  return res.status(404).json({
   error:'Daily entry not found'
  });

 db.prepare(`
  UPDATE daily SET
   date=COALESCE(?,date),
   feed_kg=COALESCE(?,feed_kg),
   dead=COALESCE(?,dead),
   weight_kg=COALESCE(?,weight_kg),
   medicine=COALESCE(?,medicine),
   other=COALESCE(?,other),
   notes=COALESCE(?,notes)
  WHERE id=?
 `).run(
  r.date,
  r.feed_kg,
  r.dead,
  r.weight_kg,
  r.medicine,
  r.other,
  r.notes,
  req.params.id
 );

 res.json({ok:true});
});

/* REPORT */
app.get('/api/report/:id',auth,(req,res)=>{
 let b=db.prepare(
  'SELECT * FROM batches WHERE id=?'
 ).get(req.params.id);

 if(!b)
  return res.status(404).json({
   error:'Batch not found'
  });

 let d=db.prepare(`
  SELECT
   COALESCE(SUM(feed_kg),0) feed,
   COALESCE(SUM(dead),0) dead,
   COALESCE(SUM(weight_kg),0) weight,
   COALESCE(SUM(medicine),0) medicine,
   COALESCE(SUM(other),0) other
  FROM daily
  WHERE batch_id=?
 `).get(b.id);

 let live=b.chicks-d.dead;
 let totalCost=b.chicks*b.chick_rate+d.medicine+d.other;
 let fcr=d.weight?d.feed/d.weight:0;
 let costKg=d.weight?totalCost/d.weight:0;
 let sale=d.weight*b.sale_rate;

 res.json({
  ...b,
  ...d,
  live,
  fcr,
  costKg,
  sale,
  profit:sale-totalCost,
  totalCost
 });
});

app.listen(
 process.env.PORT||3000,
 ()=>console.log('Poultry Manager running')
);
