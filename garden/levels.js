// levels.js
// title: shown in HUD
// crop: "carrot" | "strawberry" | "corn" | "grape" | "orange"
// target: number of crops to plant (area needed)
// prompt: story text
// refresh: if true, clear the board after completing this level; if false, keep existing fields

export const LEVELS = [
  { title:"Carrot Field", crop:"carrot", target:6, refresh:false,
    prompt:"Old MacDonald has 6 carrots to plant. Create a carrot field large enough to hold 6 carrots." },

    { title:"Carrot Field", crop:"carrot", target:6, refresh:false,
    prompt:"Great! Can you think of another way to draw a field to hold 6 carrots?" },
        { title:"Carrot Field", crop:"carrot", target:6, refresh:false,
    prompt:"Try a few more ways to draw a field for 6 carrots." },
    { title:"Carrot Field", crop:"carrot", target:6, refresh:true,
    prompt:"Try a few more ways to draw a field for 6 carrots." },

  { title:"Strawberry Patch", crop:"strawberry", target:10, refresh:false,
    prompt:"OK that's enough carrots! Now he has 10 strawberries to plant. Create a strawberry patch large enough to hold 10 strawberries." },
    { title:"Strawberry Patch", crop:"strawberry", target:10, refresh:false,
    prompt:"Is there another way to draw a field for 10 strawberries?" },
    { title:"Strawberry Patch", crop:"strawberry", target:10, refresh:true,
    prompt:"Another way?" },


  { title:"Corn Rows", crop:"corn", target:18, refresh:false,
    prompt:"Next, Old MacDonald has 18 corn seeds. Create a corn field large enough to hold 18 corn plants." },
    { title:"Corn Rows", crop:"corn", target:18, refresh:false,
    prompt:"Make another field of different shape for 18 corns" },

  { title:"Grape Vineyard", crop:"grape", target:15, refresh:false,
    prompt:"Time for grapes! Old MacDonald has 15 grapevines. Create a vineyard area large enough to hold 15 grapevines." },
      { title:"Grape Vineyard", crop:"grape", target:15, refresh:true,
    prompt:"Can you make one that matches a side of one of the corn fields?" },

  { title:"Orange Grove", crop:"orange", target:16, refresh:false,
    prompt:"Orange grove time: Old MacDonald has 16 oranges to plant. Create an orange grove large enough to hold 16 oranges." },

  { title:"Carrot Field (Quick)", crop:"carrot", target:8, refresh:false,
    prompt:"Back to carrots! Old MacDonald has 8 carrots to plant. Create a field large enough to hold 8 carrots." },

  { title:"Strawberry Patch (Bigger)", crop:"strawberry", target:12, refresh:false,
    prompt:"Old MacDonald has 12 strawberries to plant. Create a patch large enough to hold 12 strawberries." },

  { title:"Corn Rows (20)", crop:"corn", target:20, refresh:true,
    prompt:"Old MacDonald has 20 corn seeds. Create a corn field large enough to hold 20 corn plants." },
];
