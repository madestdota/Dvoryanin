//=============================================================================
// DV_Substances.js
//=============================================================================

/*:
 * @plugindesc v1.0 Субстанции (кровь, сера, ртуть, соль, ладан) и реакции между ними.
 * @author Dvoryanin
 *
 * @param infectionVariable
 * @text Переменная заражения
 * @desc Номер переменной, куда реакции с заметкой <Заражение: N> добавляют N.
 * @type variable
 * @default 1
 *
 * @help
 * Субстанция — это обычное состояние с заметкой:
 *   <Субстанция: Кровь>
 *
 * Навык или оружие накладывает субстанцию как обычное состояние
 * (эффект «Добавить состояние» у навыка или «Состояние атаки» у оружия).
 * Если на цели уже есть другая субстанция, они реагируют:
 * старая снимается, новая не накладывается, срабатывает реакция.
 * Если реакции для пары нет, новая субстанция просто заменяет старую.
 *
 * Реакция — тоже состояние, с заметкой:
 *   <Реакция: Кровь + Сера>
 * Порядок не важен: «Сера + Кровь» — та же реакция.
 * Длительность, ограничения и особенности (traits) задаются в редакторе
 * как у обычного состояния. Дополнительные заметки реакции:
 *
 *   <Мгновенно>             не вешать состояние, только сработать
 *   <УронОтМакс: 25>        сразу нанести 25% макс. HP цели
 *   <ПротивКультистов: 2>   этот урон ×2 по врагам с заметкой <Культист>
 *   <Очистить>              снять с цели усиления, субстанции и
 *                           состояния с заметкой <Мутация>
 *   <ВампиризмОтМакс: 15>   атакующий лечится на 15% макс. HP цели
 *   <Заражение: 1>          если атакует герой, переменная заражения +1
 *   <ЛечениеВредит>         пока состояние висит, лечение ранит цель
 *
 * Враг:
 *   <Культист>              для <ПротивКультистов>
 */

(function() {
    'use strict';

    var params = PluginManager.parameters('DV_Substances');
    var INFECTION_VARIABLE = Number(params['infectionVariable'] || 1);

    var meta = function(object, key) {
        if (!object || !object.meta || object.meta[key] === undefined) {
            return null;
        }
        return object.meta[key] === true ? true : String(object.meta[key]).trim();
    };

    var metaNumber = function(object, key) {
        var value = Number(meta(object, key));
        return isNaN(value) ? 0 : value;
    };

    //-------------------------------------------------------------------------
    // Таблица субстанций и реакций
    //-------------------------------------------------------------------------

    var DV = {
        built: false,
        substanceIds: {},
        reactions: {}
    };

    DV.pairKey = function(idA, idB) {
        return Math.min(idA, idB) + ',' + Math.max(idA, idB);
    };

    DV.build = function() {
        if (this.built || !$dataStates) {
            return;
        }
        var byName = {};
        $dataStates.forEach(function(state) {
            var name = meta(state, 'Субстанция');
            if (state && name && name !== true) {
                byName[name.toLowerCase()] = state.id;
                this.substanceIds[state.id] = true;
            }
        }, this);
        $dataStates.forEach(function(state) {
            var recipe = meta(state, 'Реакция');
            if (!state || !recipe || recipe === true) {
                return;
            }
            var ids = recipe.split('+').map(function(part) {
                return byName[part.trim().toLowerCase()];
            });
            if (ids.length === 2 && ids[0] && ids[1]) {
                this.reactions[this.pairKey(ids[0], ids[1])] = state.id;
            } else {
                console.warn('DV_Substances: не понял реакцию «' + recipe + '» у состояния ' + state.id);
            }
        }, this);
        this.built = true;
    };

    DV.isSubstance = function(stateId) {
        this.build();
        return !!this.substanceIds[stateId];
    };

    DV.reactionFor = function(idA, idB) {
        this.build();
        return this.reactions[this.pairKey(idA, idB)] || 0;
    };

    window.DV_Substances = DV;

    //-------------------------------------------------------------------------
    // Game_ActionResult: строки о реакциях для журнала боя
    //-------------------------------------------------------------------------

    var _Game_ActionResult_clear = Game_ActionResult.prototype.clear;
    Game_ActionResult.prototype.clear = function() {
        _Game_ActionResult_clear.call(this);
        this.dvTexts = [];
    };

    //-------------------------------------------------------------------------
    // Game_Action: наложение субстанций
    //-------------------------------------------------------------------------

    var _Game_Action_itemEffectAddNormalState = Game_Action.prototype.itemEffectAddNormalState;
    Game_Action.prototype.itemEffectAddNormalState = function(target, effect) {
        if (!DV.isSubstance(effect.dataId)) {
            _Game_Action_itemEffectAddNormalState.call(this, target, effect);
            return;
        }
        var chance = effect.value1;
        if (!this.isCertainHit()) {
            chance *= target.stateRate(effect.dataId);
            chance *= this.lukEffectRate(target);
        }
        if (Math.random() < chance) {
            this.dvApplySubstance(target, effect.dataId);
            this.makeSuccess(target);
        }
    };

    Game_Action.prototype.itemEffectAddAttackState = function(target, effect) {
        this.subject().attackStates().forEach(function(stateId) {
            var chance = effect.value1;
            chance *= target.stateRate(stateId);
            chance *= this.subject().attackStatesRate(stateId);
            chance *= this.lukEffectRate(target);
            if (Math.random() < chance) {
                if (DV.isSubstance(stateId)) {
                    this.dvApplySubstance(target, stateId);
                } else {
                    target.addState(stateId);
                }
                this.makeSuccess(target);
            }
        }.bind(this), target);
    };

    Game_Action.prototype.dvApplySubstance = function(target, stateId) {
        var current = target.states().filter(function(state) {
            return DV.isSubstance(state.id) && state.id !== stateId;
        })[0];
        if (!current) {
            target.addState(stateId);
            return;
        }
        var reactionId = DV.reactionFor(current.id, stateId);
        target.removeState(current.id);
        if (reactionId) {
            this.dvReact(target, $dataStates[reactionId]);
        } else {
            target.addState(stateId);
        }
    };

    Game_Action.prototype.dvReact = function(target, reaction) {
        var subject = this.subject();
        var result = target.result();
        result.dvTexts.push('Реакция: ' + reaction.name + '!');

        if (!meta(reaction, 'Мгновенно')) {
            target.addState(reaction.id);
        }

        var percent = metaNumber(reaction, 'УронОтМакс');
        if (percent > 0) {
            var damage = Math.floor(target.mhp * percent / 100);
            var cultMultiplier = metaNumber(reaction, 'ПротивКультистов');
            if (cultMultiplier > 0 && target.isEnemy() && meta(target.enemy(), 'Культист')) {
                damage = Math.floor(damage * cultMultiplier);
            }
            var before = result.hpDamage;
            target.gainHp(-damage);
            result.hpDamage = before + damage;
            result.dvTexts.push(reaction.name + ' наносит ещё ' + damage + ' урона.');
        }

        if (meta(reaction, 'Очистить')) {
            target.removeAllBuffs();
            target.states().forEach(function(state) {
                if (state.id !== reaction.id && (DV.isSubstance(state.id) || meta(state, 'Мутация'))) {
                    target.removeState(state.id);
                }
            });
        }

        var drainPercent = metaNumber(reaction, 'ВампиризмОтМакс');
        if (drainPercent > 0 && subject.isAlive()) {
            var heal = Math.floor(target.mhp * drainPercent / 100);
            subject.gainHp(heal);
            result.dvTexts.push(subject.name() + ' восстанавливает ' + heal + ' ' + TextManager.hpA + '.');
        }

        var infection = metaNumber(reaction, 'Заражение');
        if (infection > 0 && subject.isActor() && INFECTION_VARIABLE > 0) {
            $gameVariables.setValue(INFECTION_VARIABLE, $gameVariables.value(INFECTION_VARIABLE) + infection);
            result.dvTexts.push('Заражение растёт...');
        }
    };

    //-------------------------------------------------------------------------
    // Game_Action: лечение ранит под <ЛечениеВредит>
    //-------------------------------------------------------------------------

    var _Game_Action_makeDamageValue = Game_Action.prototype.makeDamageValue;
    Game_Action.prototype.makeDamageValue = function(target, critical) {
        var value = _Game_Action_makeDamageValue.call(this, target, critical);
        if (value < 0 && target.states().some(function(state) { return meta(state, 'ЛечениеВредит'); })) {
            value = -value;
        }
        return value;
    };

    //-------------------------------------------------------------------------
    // Window_BattleLog: вывод реакций
    //-------------------------------------------------------------------------

    var _Window_BattleLog_displayActionResults = Window_BattleLog.prototype.displayActionResults;
    Window_BattleLog.prototype.displayActionResults = function(subject, target) {
        _Window_BattleLog_displayActionResults.call(this, subject, target);
        var texts = target.result().dvTexts || [];
        if (texts.length > 0) {
            texts.forEach(function(text) {
                this.push('addText', text);
            }, this);
            this.push('waitForNewLine');
        }
    };
})();
