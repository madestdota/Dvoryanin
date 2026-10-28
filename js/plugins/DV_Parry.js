//=============================================================================
// DV_Parry.js
//=============================================================================

/*:
 * @plugindesc v2.0 Защита по таймингу от ударов врага: одиночные удары и серии в ритм.
 * @author Dvoryanin
 *
 * @param perfectWindow
 * @text Окно идеальной защиты (кадры)
 * @desc Насколько точно нужно попасть в удар: ± столько кадров. 60 кадров = 1 секунда.
 * @type number
 * @default 6
 *
 * @param goodWindow
 * @text Окно блока (кадры)
 * @desc За сколько кадров до удара нажатие ещё считается блоком.
 * @type number
 * @default 16
 *
 * @param lateWindow
 * @text Запас после удара (кадры)
 * @desc Сколько кадров после удара нажатие ещё засчитывается.
 * @type number
 * @default 6
 *
 * @param perfectRate
 * @text Урон при идеальной защите, %
 * @type number
 * @default 50
 *
 * @param goodRate
 * @text Урон при блоке, %
 * @type number
 * @default 80
 *
 * @param approach
 * @text Время сужения кольца (кадры)
 * @desc За сколько кадров до удара появляется его кольцо в серии.
 * @type number
 * @default 45
 *
 * @param rhythmMin
 * @text Замах одиночного удара: от (кадры)
 * @type number
 * @default 45
 *
 * @param rhythmMax
 * @text Замах одиночного удара: до (кадры)
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
 * Когда враг бьёт героя, к центру экрана сужается кольцо. Нажмите OK
 * (Z, Enter, Пробел или касание), когда кольцо сойдётся с кругом:
 *   - точно в момент удара — ИДЕАЛЬНО: проходит 50% урона;
 *   - чуть раньше — БЛОК: проходит 80% урона;
 *   - не успели или нажали слишком рано — полный урон.
 * Засчитывается одно нажатие на удар, долбить кнопку бесполезно.
 *
 * Если все удары атаки отражены идеально, герой контратакует.
 *
 * СЕРИИ. Навык врага может бить несколько раз подряд в своём ритме.
 * Поставьте навыку «Повторы» = числу ударов и заметку:
 *     <Серия: 50, 20, 30>
 * Первое число — через сколько кадров после начала прилетит первый удар,
 * следующие — промежутки между ударами. Каждому удару своё кольцо,
 * нажимать нужно в ритм.
 *
 * Заметки (поле «Заметка»):
 *   Враг:
 *     <Ритм: 30-60>       замах одиночного удара в кадрах (случайно)
 *     <Сигнал: Growl>     звук начала атаки (файл из audio/se)
 *   Навык:
 *     <Серия: 40, 25, 25> ритм серии (см. выше)
 *     <Неотразимо>        только блок, без идеальной защиты; кольцо красное
 *     <БезЗамаха>         удар проходит сразу, без кольца
 *
 * Работает для навыков врага с уроном по HP, если цель — живой герой,
 * который может двигаться.
 */

(function() {
    'use strict';

    var params = PluginManager.parameters('DV_Parry');
    var num = function(name, fallback) {
        var value = Number(params[name]);
        return params[name] === undefined || params[name] === '' || isNaN(value) ? fallback : value;
    };

    var CFG = {
        perfectWindow: num('perfectWindow', 6),
        goodWindow: num('goodWindow', 16),
        lateWindow: num('lateWindow', 6),
        perfectRate: num('perfectRate', 50) / 100,
        goodRate: num('goodRate', 80) / 100,
        approach: num('approach', 45),
        rhythmMin: num('rhythmMin', 45),
        rhythmMax: num('rhythmMax', 75),
        cueSe: String(params['cueSe'] || 'Sword1')
    };

    var GRADES = {
        perfect: { text: 'Идеально!', color: '#ffe680', rate: CFG.perfectRate, se: ['Parry', 100] },
        good: { text: 'Блок', color: '#a0c8ff', rate: CFG.goodRate, se: ['Parry', 70] },
        miss: { text: 'Мимо', color: '#ff8a80', rate: 1, se: null }
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
        this.dvClear();
        this._dvFlash = null;
    };

    BattleManager.dvClear = function() {
        this._dvSeries = null;
        this._dvGrades = [];
        this._dvGradeTarget = null;
        this._dvCounter = false;
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
        return action.isDamage() && !meta(action.item(), 'БезЗамаха');
    };

    BattleManager.dvHitTimes = function() {
        var series = meta(this._action.item(), 'Серия');
        if (series && series !== true) {
            var times = [];
            var at = 0;
            series.split(',').forEach(function(part) {
                var gap = Number(part);
                if (!isNaN(gap) && gap > 0) {
                    at += gap;
                    times.push(at);
                }
            });
            if (times.length > 0) {
                return times;
            }
        }
        var min = CFG.rhythmMin;
        var max = CFG.rhythmMax;
        var rhythm = meta(this._subject.enemy(), 'Ритм');
        if (rhythm && rhythm !== true) {
            var parts = rhythm.split('-').map(Number);
            if (!isNaN(parts[0])) {
                min = parts[0];
                max = isNaN(parts[1]) ? parts[0] : parts[1];
            }
        }
        return [min + Math.randomInt(Math.max(max - min, 0) + 1)];
    };

    BattleManager.dvStartSeries = function(target) {
        var hits = this.dvHitTimes().map(function(at) {
            return { at: at, grade: null };
        });
        this._dvSeries = {
            target: target,
            frame: 0,
            hits: hits,
            unparryable: !!meta(this._action.item(), 'Неотразимо')
        };
        var cue = meta(this._subject.enemy(), 'Сигнал');
        playSe(cue && cue !== true ? cue : CFG.cueSe);
    };

    BattleManager.dvGradeHit = function(hit, grade) {
        var s = this._dvSeries;
        if (grade === 'perfect' && s.unparryable) {
            grade = 'good';
        }
        hit.grade = grade;
        var info = GRADES[grade];
        if (info.se) {
            playSe(info.se[0], info.se[1]);
        }
        this._dvFlash = { text: info.text, color: info.color, time: 30 };
    };

    BattleManager.dvUpdateSeries = function() {
        var s = this._dvSeries;
        s.frame++;
        var pending = s.hits.filter(function(hit) { return hit.grade === null; });
        if (pending.length > 0 && (Input.isTriggered('ok') || TouchInput.isTriggered())) {
            var hit = pending[0];
            var delta = s.frame - hit.at;
            if (delta < -CFG.goodWindow) {
                this.dvGradeHit(hit, 'miss');
            } else if (Math.abs(delta) <= CFG.perfectWindow) {
                this.dvGradeHit(hit, 'perfect');
            } else {
                this.dvGradeHit(hit, 'good');
            }
        }
        s.hits.forEach(function(hit) {
            if (hit.grade === null && s.frame > hit.at + CFG.lateWindow) {
                this.dvGradeHit(hit, 'miss');
            }
        }, this);
        if (s.hits.every(function(hit) { return hit.grade !== null; })) {
            this._dvGrades = s.hits.map(function(hit) { return hit.grade; });
            this._dvGradeTarget = s.target;
            this._dvCounter = !s.unparryable && this._dvGrades.every(function(g) { return g === 'perfect'; });
            this._dvSeries = null;
        }
    };

    var _BattleManager_updateAction = BattleManager.updateAction;
    BattleManager.updateAction = function() {
        if (this._dvSeries) {
            this.dvUpdateSeries();
            if (this._dvSeries) {
                return;
            }
        } else if (this._dvGrades.length === 0 && this.dvNeedsWindup(this._targets[0])) {
            this.dvStartSeries(this._targets[0]);
            return;
        }
        _BattleManager_updateAction.call(this);
    };

    var _BattleManager_invokeAction = BattleManager.invokeAction;
    BattleManager.invokeAction = function(subject, target) {
        if (this._dvGrades.length > 0 && this._dvGradeTarget !== target) {
            this.dvClear();
        }
        var grade = this._dvGrades.shift();
        if (grade) {
            target._dvRate = GRADES[grade].rate;
            if (grade === 'good') {
                this._logWindow.push('addText', target.name() + ' блокирует удар.');
            } else if (grade === 'perfect') {
                this._logWindow.push('addText', target.name() + ' идеально отражает удар!');
            }
        }
        _BattleManager_invokeAction.call(this, subject, target);
        target._dvRate = undefined;
        if (grade && this._dvGrades.length === 0 && this._dvCounter) {
            this._dvCounter = false;
            if (target.isAlive() && subject.isAlive()) {
                this.dvInvokeCounter(subject, target);
            }
        }
    };

    BattleManager.dvInvokeCounter = function(subject, target) {
        this._logWindow.push('pushBaseLine');
        this._logWindow.push('addText', target.name() + ' контратакует!');
        var counter = new Game_Action(target);
        counter.setAttack();
        counter.apply(subject);
        this._logWindow.displayActionResults(target, subject);
        this._logWindow.push('popBaseLine');
        this.refreshStatus();
    };

    var _BattleManager_endAction = BattleManager.endAction;
    BattleManager.endAction = function() {
        this.dvClear();
        _BattleManager_endAction.call(this);
    };

    //-------------------------------------------------------------------------
    // Game_Action: урон с учётом защиты
    //-------------------------------------------------------------------------

    var _Game_Action_makeDamageValue = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function(target, critical) {
        var value = _Game_Action_makeDamageValue.call(this, target, critical);
        if (target._dvRate !== undefined && value > 0) {
            value = Math.max(1, Math.floor(value * target._dvRate));
        }
        return value;
    };

    //-------------------------------------------------------------------------
    // Sprite_DvParryCue: кольца ударов, счётчик серии и надпись
    //-------------------------------------------------------------------------

    function Sprite_DvParryCue() {
        this.initialize.apply(this, arguments);
    }

    Sprite_DvParryCue.prototype = Object.create(Sprite.prototype);
    Sprite_DvParryCue.prototype.constructor = Sprite_DvParryCue;

    Sprite_DvParryCue.SIZE = 360;
    Sprite_DvParryCue.INNER = 36;
    Sprite_DvParryCue.OUTER = 170;
    Sprite_DvParryCue.PIP_COLORS = { perfect: '#ffe680', good: '#a0c8ff', miss: '#ff8a80' };

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
        this._labelText = '';
    };

    Sprite_DvParryCue.prototype.update = function() {
        Sprite.prototype.update.call(this);
        this.updateRings();
        this.updateLabel();
    };

    Sprite_DvParryCue.prototype.updateRings = function() {
        var s = BattleManager._dvSeries;
        if (!s) {
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
        var outer = Sprite_DvParryCue.OUTER;
        var color = s.unparryable ? '255,80,80' : '255,255,255';
        b.clear();
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(' + color + ',0.85)';
        ctx.beginPath();
        ctx.arc(c, c, inner, 0, Math.PI * 2, false);
        ctx.stroke();
        s.hits.forEach(function(hit, i) {
            if (hit.grade !== null) {
                return;
            }
            var lead = i === 0 ? hit.at : CFG.approach;
            var left = hit.at - s.frame;
            if (left > lead) {
                return;
            }
            var rest = Math.max(left, 0) / Math.max(lead, 1);
            ctx.lineWidth = 7;
            ctx.strokeStyle = 'rgba(' + color + ',' + (0.35 + 0.65 * (1 - rest)) + ')';
            ctx.beginPath();
            ctx.arc(c, c, inner + (outer - inner) * rest, 0, Math.PI * 2, false);
            ctx.stroke();
        });
        if (s.hits.length > 1) {
            var gap = 28;
            var x0 = c - gap * (s.hits.length - 1) / 2;
            var y = c + inner + 32;
            s.hits.forEach(function(hit, i) {
                ctx.beginPath();
                ctx.arc(x0 + gap * i, y, 9, 0, Math.PI * 2, false);
                ctx.fillStyle = hit.grade ? Sprite_DvParryCue.PIP_COLORS[hit.grade] : 'rgba(0,0,0,0.55)';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.stroke();
                ctx.lineWidth = 2;
                ctx.strokeStyle = 'rgba(' + color + ',0.9)';
                ctx.stroke();
            });
        }
        ctx.restore();
        b._setDirty();
    };

    Sprite_DvParryCue.prototype.updateLabel = function() {
        var s = BattleManager._dvSeries;
        var flash = BattleManager._dvFlash;
        var text = '';
        var color = '#ffffff';
        var big = false;
        if (flash && flash.time > 0) {
            text = flash.text;
            color = flash.color;
            big = true;
            flash.time--;
            this._label.opacity = Math.min(255, flash.time * 14);
        } else if (s) {
            text = s.unparryable ? 'Только блок' : 'Z / Пробел — в момент удара';
            this._label.opacity = 200;
        }
        var key = text + color;
        if (key !== this._labelText) {
            this._labelText = key;
            var lb = this._label.bitmap;
            lb.clear();
            lb.fontSize = big ? 32 : 20;
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
