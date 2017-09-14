import CSF from './csf'
import SQL from 'sql.js'
import XLSX from 'xlsx'



// Generated by CoffeeScript 1.7.1
var createDb, db;

if (typeof importScripts === 'function') {
  db = null;
  createDb = function(data) {
    if (db != null) {
      db.close();
    }
    return db = new SQL.Database(data);
  };
  self.onmessage = function(event) {
    var buff, callback, data, done, err;
    data = event['data'];
    switch (data != null ? data['action'] : void 0) {
      case 'open':
        buff = data['buffer'];
        var array, isSQLite;
        if(buff){
          array = new Uint8Array(buff);
          isSQLite = 'SQLite format 3'.split('')
            .every((k, i) => k.charCodeAt(0) == array[i]) &&
            array[15] == 0;
        }
        createDb((isSQLite ? array : void 0));
        if(buff && !isSQLite){
          var str = Uint8ArrayToString(array);

          var json_list, errors = [];
          if(str.match(/\s*\[/)){
            // JSON list
            try {
              json_list = JSON.parse(str)
            } catch (err) { errors.push(err) }
            
          }else if(str.match(/\s*\{/)){
            // JSONM
            var tmp_list = []
            str.split('\n').forEach(k => {
              try {
                tmp_list.push(JSON.parse(k))
              } catch (err) { errors.push(err) }
            })
            if(tmp_list.length > 0){
              json_list = tmp_list;
            }
          }
          if(json_list){
            var fields = {}
            json_list.forEach(k => Object.keys(k).forEach(j => fields[j] = true));
            var keys = Object.keys(fields);

            function run_stmt(x){
              console.log(x)
              db.exec(x)
            }

            function escapeIdent(x){
              return '"' + (x + '').replace(/"/g, '""') + '"'
            }
            function escapeStr(x){
              return "'" + (x + '').replace(/'/g, "''") + "'"
            }
            var sname = data['sname'] || "Sheet1"
            run_stmt('DROP TABLE IF EXISTS ' + escapeIdent(sname) + ';')
            run_stmt('CREATE TABLE ' + escapeIdent(sname) + ' (' + keys.map(k => `${escapeIdent(k)} TEXT`).join(', ') + ');');

            json_list.forEach(k => {
              run_stmt("INSERT INTO " +escapeIdent(sname) + " (" + Object.keys(k).map(escapeIdent).join(", ") + ") VALUES (" + Object.values(k).map(escapeStr).join(",") + ");");
            })

          }else{
            var not_sql = false;
            try {
              db.exec(str);
            } catch (err) {
              console.log("Failed attempt to interpet as SQL: " + err);
              not_sql = true;
            }
            
            if(not_sql){
              var wb = XLSX.read(str, { type: 'binary' })
              wb.SheetNames.forEach(function(s) { 
                var sname = wb.SheetNames.length > 1
                  ? s
                  : (data['sname'] || s)
                prepforsexql(wb.Sheets[s], sname, function(stmt){
                  db.exec(stmt);
                }); 
              });
            }

            
          }
        }

        return postMessage({
          'id': data['id'],
          'ready': true
        });
      case 'exec':
        if (db === null) {
          createDb();
        }
        if (!data['sql']) {
          throw 'exec: Missing query string';
        }
        return postMessage({
          'id': data['id'],
          'results': db.exec(data['sql'])
        });
      case 'each':
        if (db === null) {
          createDb();
        }
        callback = function(row) {
          return postMessage({
            'id': data['id'],
            'row': row,
            'finished': false
          });
        };
        done = function() {
          return postMessage({
            'id': data['id'],
            'finished': true
          });
        };
        return db.each(data['sql'], data['params'], callback, done);
      case 'export':
        buff = db["export"]().buffer;
        try {
          return postMessage({
            'id': data['id'],
            'buffer': buff
          }, [buff]);
        } catch (_error) {
          err = _error;
          return postMessage({
            'id': data['id'],
            'buffer': buff
          });
        }
        break;
      case 'close':
        return db != null ? db.close() : void 0;
      default:
        throw new 'Invalid action : ' + (data != null ? data['action'] : void 0);
    }
  };
}

function arrayBufferToString(data) {
  var o = "", l = 0, w = 10240;
  for(; l<data.byteLength/w; ++l) o+=String.fromCharCode.apply(null,new Uint8Array(data.slice(l*w,l*w+w)));
  o+=String.fromCharCode.apply(null, new Uint8Array(data.slice(l*w)));
  return o;
}


function Uint8ArrayToString(data){
  var arr = new Array();
  for(var i = 0; i != data.length; ++i) arr[i] = String.fromCharCode(data[i]);
  return arr.join("");
}


// based on sheetjs.com/sexql/


function prepforsexql(ws, sname, prepstmt) {
  // console.log(ws)

  if(!ws || !ws['!ref']) return;
  var range = CSF.utils.decode_range(ws['!ref']);
  if(!range || !range.s || !range.e || range.s > range.e) return;
  global.CSF = CSF;

  console.log(range)
  /* resolve types */
  var types = new Array(range.e.c-range.s.c+1);
  var names = new Array(range.e.c-range.s.c+1);  
  var R = range.s.r;
  for(var C = range.s.c; C<= range.e.c; ++C){
    names[C-range.s.c] = (ws[CSF.utils.encode_cell({c:C,r:R})]||{v: CSF.utils.encode_cell({c:C,r:R})}).v;
  }

  for(var C = range.s.c; C<= range.e.c; ++C)
    for(R = range.s.r+1; R<= range.e.r; ++R)
      switch((ws[CSF.utils.encode_cell({c:C,r:R})]||{}).t) {
        case 'e': break; /* error type */
        case 'b': /* boolean -> number */
        case 'n': if(types[C-range.s.c] !== "TEXT") types[C-range.s.c] = "REAL"; break;
        case 's': case 'str': types[C-range.s.c] = "TEXT";
        default: break; /* if the cell doesnt exist */
      }
  
  console.log(names, range, types);

  /* update list */
  // $buttons.innerHTML += "<h2>`" + sname + "`</h2>"
  // var ss = ""
  // names.forEach(function(n) { if(n) ss += "`" + n + "`<br />"; });
  // $buttons.innerHTML += "<h3>" + ss + "</h3>";
  /* create table */
  // prepstmt("CREATE TABLE `" + sname + "` (" + names.map(function(n, i) { return "`" + n + "` " + (types[i]||"TEXT"); }).join(", ") + ");" );
  prepstmt("DROP TABLE IF EXISTS `" + sname + "`;" );
  prepstmt("CREATE TABLE `" + sname + "` (" + names.map(function(n, i) { return "`" + n + "` " + (types[i]||"TEXT"); }).join(", ") + ");" );

  /* insert data */
  for(R = range.s.r+1; R<= range.e.r; ++R) {
    var fields = [], values = [];
    for(var C = range.s.c; C<= range.e.c; ++C) {
      var cell = ws[CSF.utils.encode_cell({c:C,r:R})];
      if(!cell) continue;
      fields.push("`" + names[C-range.s.c] + "`");
      values.push(types[C-range.s.c] === "REAL" ? cell.v : '"' + cell.v.toString().replace(/"/g, '""') + '"');
    }
    prepstmt("INSERT INTO `" +sname+ "` (" + fields.join(", ") + ") VALUES (" + values.join(",") + ");");
  }

}
