//=============================================================================
// DV_Parry.js
//=============================================================================

/*:
 * @plugindesc v1.0 Блок и парирование по таймингу, когда враг бьёт героя.
 * @author Dvoryanin
 *
 * @param parryWindow
 * @text Окно парирования (кадры)
 * @desc Насколько точно нужно попасть в момент удара: ± столько кадров. 60 кадров = 1 секунда.
 * @type number
 * @default 6
 *
 * @param blockWindow
 * @text Окно блока (кадры)
 * @desc За сколько кадров до удара нажатие ещё засчитывается как блок.
 * @type number
 * @default 16
 *
 * @param lateWindow
 * @text Запас после удара (кадры)
 * @desc Сколько кадров после удара нажатие ещё засчитывается.
 * @type number
 * @default 6
 *
 * @param blockRate
 * @text Урон при блоке, %
 * @desc Какая часть урона проходит при блоке.
 * @type number
 * @default 50
 *
 * @param parryCost
 * @text Цена парирования (выносливость)
 * @desc Сколько TP (выносливости) тратит парирование. Если не хватает, получится только блок.
 * @type number
 * @default 20
 *
 * @param startTp
 * @text Выносливость в начале боя
 * @type number
 * @default 50
 *
 * @param tpRegen
 * @text Восстановление выносливости за ход
 * @type number
 * @default 10
 *
 * @param rhythmMin
 * @text Замах по умолчанию: от (кадры)
 * @type number
 * @default 45
 *
 * @param rhythmMax
 * @text Замах по умолчанию: до (кадры)
 * @type number
 * @default 75
 *
 * @param cueSe
 * @text Звук замаха по умолчанию
 * @type file
 * @dir audio/se/
 * @require 1
 * @default Sword1
 *
 * @help
 * Когда враг атакует героя, перед ударом появляется сужающееся кольцо.
 * Нажмите OK (Z, Enter, Пробел или касание), когда кольцо сойдётся с
 * внутренним кругом:
 *   - точно в момент удара — ПАРИРОВАНИЕ: урона нет, герой контратакует
 *     обычной атакой. Стоит выносливость (TP);
 *   - чуть раньше — БЛОК: проходит только часть урона;
 *   - слишком рано или поздно — полный урон. Засчитывается только
 *     первое нажатие, поэтому долбить кнопку бесполезно.
 *
 * Заметки (поле «Заметка»):
 *
 *   Враг:
 *     <Ритм: 30-60>       длина замаха в кадрах, случайно в этих пределах
 *     <Сигнал: Growl>     звук начала замаха (файл из audio/se)
 *
 *   Навык:
 *     <Неотразимо>        удар можно только заблокировать, кольцо красное
 *     <БезЗамаха>         удар проходит сразу, без кольца
 *
 * Работает для навыков врага с уроном по HP (тип «Урон HP» или
 * «Поглощение HP»), если цель — живой герой, который может двигаться.
 */

(function() {
    'use strict';

    var params = PluginManager.parameters('DV_Parry');
    var num = function(name, fallback) {
        var value = Number(params[name]);
        return params[name] === undefined || params[name] === '' || isNaN(value) ? fallback : value;
    };

    var CFG = {
        parryWindow: num('parryWindow', 6),
        blockWindow: num('blockWindow', 16),
        lateWindow: num('lateWindow', 6),
        blockRate: num('blockRate', 50) / 100,
        parryCost: num('parryCost', 20),
        startTp: num('startTp', 50),
        tpRegen: num('tpRegen', 10),
        rhythmMin: num('rhythmMin', 45),
        rhythmMax: num('rhythmMax', 75),
        cueSe: String(params['cueSe'] || 'Sword1')
    };

    var meta = function(object, key) {
        if (!object || !object.meta || object.meta[key] === undefined) {
            return null;
        }
        return object.meta[key] === true ? true : String(object.meta[key]).trim();
    };

    var playSe = function(name, pitch) {
        if (name) {
            AudioManager.playSe({ name: name, volume: 90, pitch: pitch || 100, pan: 0 });
        }
    };

    //-------------------------------------------------------------------------
    // BattleManager
    //-------------------------------------------------------------------------

    var _BattleManager_initMembers = BattleManager.initMembers;
    BattleManager.initMembers = function() {
        _BattleManager_initMembers.call(this);
        this._dvWindup = null;
        this._dvGrade = null;
        this._dvFlash = null;
    };

    BattleManager.dvNeedsWindup = function(target) {
        var subject = this._subject;
        var action = this._action;
        if (!subject || !subject.isEnemy() || !action || !action.item()) {
            return false;
        }
        if (!target || !target.isActor() || !target.isAlive() || !target.canMove()) {
            return false;
        }
        if (!action.isDamage() || meta(action.item(), 'БезЗамаха')) {
            return false;
        }
        return true;
    };

    BattleManager.dvStartWindup = function(target) {
        var enemy = this._subject.enemy();
        var min = CFG.rhythmMin;
        var max = CFG.rhythmMax;
        var rhythm = meta(enemy, 'Ритм');
        if (rhythm && rhythm !== true) {
            var parts = rhythm.split('-').map(Number);
            if (!isNaN(parts[0])) {
                min = parts[0];
                max = isNaN(parts[1]) ? parts[0] : parts[1];
            }
        }
        this._dvWindup = {
            target: target,
            frame: 0,
            hit: min + Math.randomInt(Math.max(max - min, 0) + 1),
            press: null,
            unparryable: !!meta(this._action.item(), 'Неотразимо')
        };
        var cue = meta(enemy, 'Сигнал');
        playSe(cue && cue !== true ? cue : CFG.cueSe);
    };

    BattleManager.dvUpdateWindup = function() {
        var w = this._dvWindup;
        w.frame++;
        if (w.press === null && (Input.isTriggered('ok') || TouchInput.isTriggered())) {
            w.press = w.frame;
        }
        var pressedInTime = w.press !== null && w.frame >= w.hit;
        if (pressedInTime || w.frame >= w.hit + CFG.lateWindow) {
            this.dvResolveWindup();
        }
    };

    BattleManager.dvResolveWindup = function() {
        var w = this._dvWindup;
        var grade = 'none';
        if (w.press !== null) {
            var delta = w.press - w.hit;
            if (Math.abs(delta) <= CFG.parryWindow) {
                grade = 'parry';
            } else if (delta >= -CFG.blockWindow && delta <= CFG.lateWindow) {
                grade = 'block';
            }
        }
        if (grade === 'parry' && (w.unparryable || w.target.tp < CFG.parryCost)) {
            grade = 'block';
        }
        if (grade === 'parry') {
            w.target.gainSilentTp(-CFG.parryCost);
            playSe('Parry', 100);
            this._dvFlash = { text: 'ПАРИРОВАНО!', color: '#ffe680', time: 45 };
        } else if (grade === 'block') {
            playSe('Parry', 70);
            this._dvFlash = { text: 'Блок', color: '#a0c8ff', time: 35 };
        }
        this._dvWindup = null;
        this._dvGrade = grade;
    };

    var _BattleManager_updateAction = BattleManager.updateAction;
    BattleManager.updateAction = function() {
        if (this._dvWindup) {
            this.dvUpdateWindup();
            if (this._dvWindup) {
                return;
            }
        } else if (this._dvGrade === null && this.dvNeedsWindup(this._targets[0])) {
            this.dvStartWindup(this._targets[0]);
            return;
        }
        _BattleManager_updateAction.call(this);
    };

    var _BattleManager_invokeAction = BattleManager.invokeAction;
    BattleManager.invokeAction = function(subject, target) {
        var grade = this._dvGrade;
        this._dvGrade = null;
        if (grade === 'parry') {
            this.dvInvokeParry(subject, target);
            return;
        }
        if (grade === 'block') {
            target._dvBlocking = true;
            this._logWindow.push('addText', target.name() + ' блокирует удар!');
        }
        _BattleManager_invokeAction.call(this, subject, target);
        target._dvBlocking = false;
    };

    BattleManager.dvInvokeParry = function(subject, target) {
        this._logWindow.push('pushBaseLine');
        this._logWindow.push('addText', target.name() + ' парирует удар и контратакует!');
        var counter = new Game_Action(target);
        counter.setAttack();
        counter.apply(subject);
        this._logWindow.displayActionResults(target, subject);
        this._logWindow.push('popBaseLine');
        this.refreshStatus();
    };

    //-------------------------------------------------------------------------
    // Game_Action: урон при блоке
    //-------------------------------------------------------------------------

    var _Game_Action_makeDamageValue = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function(target, critical) {
        var value = _Game_Action_makeDamageValue.call(this, target, critical);
        if (target._dvBlocking && value > 0) {
            value = Math.floor(value * CFG.blockRate);
        }
        return value;
    };

    //-------------------------------------------------------------------------
    // Game_Actor: выносливость (TP)
    //-------------------------------------------------------------------------

    Game_Actor.prototype.initTp = function() {
        this.setTp(CFG.startTp);
    };

    Game_Actor.prototype.regenerateTp = function() {
        Game_Battler.prototype.regenerateTp.call(this);
        this.gainSilentTp(CFG.tpRegen);
    };

    //-------------------------------------------------------------------------
    // Sprite_DvParryCue: кольцо замаха и надпись результата
    //-------------------------------------------------------------------------

    function Sprite_DvParryCue() {
        this.initialize.apply(this, arguments);
    }

    Sprite_DvParryCue.prototype = Object.create(Sprite.prototype);
    Sprite_DvParryCue.prototype.constructor = Sprite_DvParryCue;

    Sprite_DvParryCue.SIZE = 360;
    Sprite_DvParryCue.INNER = 36;
    Sprite_DvParryCue.OUTER = 170;

    Sprite_DvParryCue.prototype.initialize = function() {
        Sprite.prototype.initialize.call(this);
        this.bitmap = new Bitmap(Sprite_DvParryCue.SIZE, Sprite_DvParryCue.SIZE);
        this.anchor.x = 0.5;
        this.anchor.y = 0.5;
        this.x = Graphics.boxWidth / 2;
        this.y = Graphics.boxHeight / 2 - 70;
        this._label = new Sprite(new Bitmap(480, 48));
        this._label.anchor.x = 0.5;
        this._label.anchor.y = 0.5;
        this._label.y = Sprite_DvParryCue.SIZE / 2 - 4;
        this.addChild(this._label);
        this._wasActive = false;
        this._flashText = '';
    };

    Sprite_DvParryCue.prototype.update = function() {
        Sprite.prototype.update.call(this);
        this.updateRing();
        this.updateLabel();
    };

    Sprite_DvParryCue.prototype.updateRing = function() {
        var w = BattleManager._dvWindup;
        if (!w) {
            if (this._wasActive) {
                this.bitmap.clear();
                this._wasActive = false;
            }
            return;
        }
        this._wasActive = true;
        var b = this.bitmap;
        var ctx = b._context;
        var c = Sprite_DvParryCue.SIZE / 2;
        var inner = Sprite_DvParryCue.INNER;
        var rest = Math.max(w.hit - w.frame, 0) / w.hit;
        var radius = inner + (Sprite_DvParryCue.OUTER - inner) * rest;
        var color = w.unparryable ? '255,80,80' : '255,255,255';
        b.clear();
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(' + color + ',0.85)';
        ctx.beginPath();
        ctx.arc(c, c, inner, 0, Math.PI * 2, false);
        ctx.stroke();
        ctx.lineWidth = 7;
        ctx.strokeStyle = 'rgba(' + color + ',' + (0.35 + 0.65 * (1 - rest)) + ')';
        ctx.beginPath();
        ctx.arc(c, c, radius, 0, Math.PI * 2, false);
        ctx.stroke();
        ctx.restore();
        b._setDirty();
    };

    Sprite_DvParryCue.prototype.updateLabel = function() {
        var w = BattleManager._dvWindup;
        var flash = BattleManager._dvFlash;
        var text = '';
        var color = '#ffffff';
        if (flash && flash.time > 0) {
            text = flash.text;
            color = flash.color;
            flash.time--;
            this._label.opacity = Math.min(255, flash.time * 12);
        } else if (w) {
            text = w.unparryable ? 'Не парировать — только блок' : 'Z / Пробел — в момент удара';
            this._label.opacity = 200;
        }
        if (text !== this._flashText) {
            this._flashText = text;
            var lb = this._label.bitmap;
            lb.clear();
            lb.fontSize = flash && flash.time > 0 ? 32 : 20;
            lb.textColor = color;
            lb.drawText(text, 0, 0, lb.width, lb.height, 'center');
        }
    };

    var _Scene_Battle_createSpriteset = Scene_Battle.prototype.createSpriteset;
    Scene_Battle.prototype.createSpriteset = function() {
        _Scene_Battle_createSpriteset.call(this);
        this.addChild(new Sprite_DvParryCue());
    };

    window.Sprite_DvParryCue = Sprite_DvParryCue;
})();
