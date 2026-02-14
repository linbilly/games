import { UI } from './ui.js';
import { Game } from './game.js';

const ui = new UI();
const canvas = document.getElementById('stage');
const game = new Game(canvas, ui);

ui.bindGame(game);
game.init();
ui.showMenu(true);
