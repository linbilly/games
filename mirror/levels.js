/* Mirror Maze - Shared Levels + Helpers
   - Campaign levels live here (hand-authored / reviewed).
   - Both play (game.js) and editor (editor.js) import this file.

   Level format:
   {
     name: "Intro 01",
     size: 8,                 // 8 | 10 | 12
     checkpoint: true,        // reaching this level sets checkpoint to this level index (1-based)
     alienRow: 3,             // optional; if omitted/invalid, game will auto-pick reachable right-exit row
     grid: [                  // array of strings length == size
       "........",            // '.' empty, '/' mirror, '\' mirror
       ...
     ]
   }

   NOTE: In JS strings, a backslash mirror is written as '\\' inside the string.
*/

export const CAMPAIGN_LEVELS = [



  

  {
    "name": "Intro 01",
    "size": 8,
    "checkpoint": false,
    "alienRow": 4,
    "grid": [
      "........",
      "........",
      "........",
      "....\\...",
      "....\\...",
      "........",
      "........",
      "........"
    ]
  },

  {
  "name": "Intro 2",
  "size": 8,
  "checkpoint": false,
  "alienRow": 0,
  "grid": [
    ".../....",
    ".../....",
    "...\\....",
    "...\\....",
    ".../....",
    ".../....",
    "...\\....",
    "...\\...."
  ]
},

{
  "name": "Intro 3",
  "size": 8,
  "checkpoint": false,
  "alienRow": 3,
  "grid": [
    ".../..\\.",
    ".../..\\.",
    ".../..\\.",
    ".../..\\.",
    ".../..\\.",
    ".../..\\.",
    ".../..\\.",
    ".../..\\."
  ]
},

{
  "name": "Intro 4",
  "size": 8,
  "checkpoint": false,
  "alienRow": 6,
  "grid": [
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\.",
    "/.\\./.\\."
  ]
},

{
  "name": "Diamond",
  "size": 8,
  "checkpoint": true,
  "alienRow": 4,
  "grid": [
    ".../\\...",
    "../..\\..",
    "././\\.\\.",
    "../..\\..",
    "..\\../..",
    ".\\.\\/./.",
    "..\\../..",
    "...\\/..."
  ]
},

{
  "name": "Big S",
  "size": 8,
  "checkpoint": false,
  "alienRow": 0,
  "grid": [
    "./......",
    "........",
    "........",
    "........",
    ".\\....\\.",
    "........",
    "........",
    "....../."
  ]
},

{
  "name": "Big W",
  "size": 8,
  "checkpoint": false,
  "alienRow": 2,
  "grid": [
    "........",
    "........",
    ".\\./\\./.",
    "........",
    "........",
    "........",
    ".\\./\\./.",
    "........"
  ]
},

{
  "name": "The spiral",
  "size": 8,
  "checkpoint": false,
  "alienRow": 4,
  "grid": [
    ".......\\",
    "/.....\\.",
    "./...\\..",
    "../.\\...",
    "....\\...",
    "..\\../..",
    ".\\..../.",
    "\\....../"
  ]
},
{
  "name": "Random 1",
  "size": 8,
  "checkpoint": true,
  "alienRow": 3,
  "grid": [
    "/...././",
    ".\\././..",
    "./..\\../",
    ".../../.",
    "/./.../.",
    "../.\\...",
    "/..\\././",
    "../../.."
  ]
}, 
{
  "name": "Random 2",
  "size": 10,
  "checkpoint": false,
  "alienRow": 8,
  "grid": [
    ".....\\/...",
    "../...//..",
    "../.......",
    ".....\\.\\.\\",
    "/......\\..",
    "/\\........",
    ".......\\/.",
    ".\\//\\..\\..",
    "//........",
    "/\\.../\\/.."
  ]
},
{
  "name": "Crossfire Corridor",
  "size": 10,
  "checkpoint": true,
  "alienRow": 7,
  "grid": [
    "..........",
    "..../.....",
    "...\\......",
    "...../....",
    "..\\.......",
    "....../...",
    "......\\...",
    "...\\......",
    ".....\\....",
    ".........."
  ]
}, 

{
  "name": "Reflection Trap",
  "size": 10,
  "checkpoint": false,
  "alienRow": 1,
  "grid": [
    ".../......",
    "..\\....../",
    "...../....",
    "...\\......",
    "....../...",
    "..\\....../",
    ".....\\....",
    ".../......",
    "......../.",
    ".........."
  ]
}, 

{
  "name": "Double Bounce Gauntlet",
  "size": 12,
  "checkpoint": false,
  "alienRow": 8,
  "grid": [
    "..../....\\..",
    "......\\..../",
    "...\\..../...",
    "...../..\\...",
    "..\\.../.....",
    "..../..\\....",
    "...\\....../.",
    ".../....\\...",
    "..../....\\..",
    "...\\..../...",
    "....../...\\.",
    "............"
  ]
},
{
  "name": "Brutal Mirror Labyrinth",
  "size": 12,
  "checkpoint": true,
  "alienRow": 2,
  "grid": [
    "/\\.\\.\\/\\/\\.\\",
    "./\\./...\\/\\\\",
    ".\\/...\\../\\.",
    "\\/.\\\\..\\.\\..",
    "//../\\.\\..//",
    "/.//.\\.\\///\\",
    "\\/\\.//..\\\\\\/",
    "\\.///\\\\\\.//\\",
    ".\\\\\\../\\.\\//",
    "/\\/\\./\\/../.",
    "./\\\\/.../..\\",
    ".\\//./\\\\/..\\"
  ]
},

{
  "name": "Red Mirror",
  "size": 8,
  "checkpoint": false,
  "alienRow": 4,
  "grid": [
    "........",
    ".../....",
    ".../....",
    ".../....",
    "...r....",
    ".../....",
    "........",
    "........"
  ]
},

{
  "name": "X marks the spot",
  "size": 8,
  "checkpoint": false,
  "alienRow": 3,
  "grid": [
    "........",
    ".../\\...",
    ".../\\...",
    "...rR...",
    "...Rr...",
    "...\\/...",
    "...\\/...",
    "........"
  ]
}, 

{
  "name": "Red Goalies",
  "size": 8,
  "checkpoint": false,
  "alienRow": 4,
  "grid": [
    "../\\./..",
    ".///\\\\\\.",
    ".\\....R.",
    "../...R.",
    "..\\...r.",
    "./....r.",
    ".\\\\\\///.",
    "..\\/.\\.."
  ]
}, 


  
];

export function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }

export function normalizeLevelObject(obj){
  const size = Number(obj.size);
  if(!(size===8||size===10||size===12)){
    throw new Error("size must be 8, 10, or 12");
  }

  const gridStrings = obj.grid;
  if(!Array.isArray(gridStrings) || gridStrings.length !== size){
    throw new Error("grid must be an array of length == size");
  }

  const grid = [];

  for(let y=0; y<size; y++){
    const s = String(gridStrings[y]);

    if(s.length !== size){
      throw new Error(`grid row ${y} must have length ${size}`);
    }

    const row = [];

    for(let x=0; x<size; x++){
      const ch = s[x];

      if(
        ch === "." ||
        ch === "/" ||
        ch === "\\" ||
        ch === "R" ||   // rotatable slash
        ch === "r"      // rotatable backslash
      ){
        row.push(ch);
      }
      else {
        throw new Error(
          `invalid char '${ch}' at (${x},${y}) — use '.', '/', '\\\\', 'R', or 'r'`
        );
      }
    }

    grid.push(row);
  }

  return {
    name: String(obj.name || "Untitled").slice(0, 60),
    size,
    checkpoint: !!obj.checkpoint,
    alienRow: (
      Number.isFinite(obj.alienRow)
        ? clamp(obj.alienRow|0, 0, size-1)
        : null
    ),
    grid
  };
}


export function levelToExportPayload(level){
  return {
    name: level.name,
    size: level.size,
    checkpoint: !!level.checkpoint,
    alienRow: level.alienRow|0,
    grid: level.grid.slice()
  };
}

export function payloadToJSSnippet(payload){
  const name = JSON.stringify(payload.name);
  const size = payload.size|0;
  const checkpoint = !!payload.checkpoint;
  const alienRow = payload.alienRow|0;
  const rows = payload.grid.map(r => JSON.stringify(String(r).replace(/\\/g, "\\\\")));
  return `{
  name: ${name},
  size: ${size},
  checkpoint: ${checkpoint},
  alienRow: ${alienRow},
  grid: [
${rows.map(r => "    " + r).join(",\\n")}
  ]
}`;
}
