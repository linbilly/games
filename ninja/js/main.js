import { Game } from './game.js';
import { UI } from './ui.js';

const canvas = document.getElementById('stage');
const ui = new UI();
const game = new Game(canvas, ui);

ui.bind(game);
game.init();

// Start with menu open
ui.showMenu(true);
