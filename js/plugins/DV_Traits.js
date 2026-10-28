//=============================================================================
// DV_Traits.js
//=============================================================================

/*:
 * @plugindesc v1.0 Черты героя: постоянные пассивки, которые даёт сюжет.
 * @author Dvoryanin
 *
 * @help
 * Черта — это состояние в базе данных с заметкой <Черта>. На героя оно
 * не накладывается: его особенности (traits) просто действуют всегда,
 * и их не снимает ни «Полное восстановление», ни конец боя.
 *
 * Команда плагина (событие → «Команда плагина»):
 *   DV_TRAIT add 22      дать партии черту из состояния №22
 *   DV_TRAIT remove 22   забрать черту
 *
 * Условие в событии: «Скрипт» → $gameParty.dvHasTrait(22)
 *
 * Дополнительные заметки черты:
 *   <Золото: 20>          +20% денег за победу в бою
 *   <ОкноИдеальной: 3>    окно идеальной защиты шире на 3 кадра
 *                         (читает плагин DV_Parry)
 */

(function() {
    'use strict';

    var metaNumber = function(object, key) {
        var value = object && object.meta ? Number(object.meta[key]) : NaN;
        return isNaN(value) ? 0 : value;
    };

    Game_Party.prototype.dvTraitIds = function() {
        if (!this._dvTraits) {
            this._dvTraits = [];
        }
        return this._dvTraits;
    };

    Game_Party.prototype.dvHasTrait = function(stateId) {
        return this.dvTraitIds().contains(stateId);
    };

    Game_Party.prototype.dvAddTrait = function(stateId) {
        if (!this.dvHasTrait(stateId)) {
            this.dvTraitIds().push(stateId);
            this.members().forEach(function(actor) { actor.refresh(); });
        }
    };

    Game_Party.prototype.dvRemoveTrait = function(stateId) {
        this._dvTraits = this.dvTraitIds().filter(function(id) { return id !== stateId; });
        this.members().forEach(function(actor) { actor.refresh(); });
    };

    Game_Party.prototype.dvTraitStates = function() {
        return this.dvTraitIds().map(function(id) { return $dataStates[id]; }).filter(Boolean);
    };

    Game_Party.prototype.dvTraitSum = function(key) {
        return this.dvTraitStates().reduce(function(sum, state) { return sum + metaNumber(state, key); }, 0);
    };

    var _Game_Actor_traitObjects = Game_Actor.prototype.traitObjects;
    Game_Actor.prototype.traitObjects = function() {
        var objects = _Game_Actor_traitObjects.call(this);
        return $gameParty ? objects.concat($gameParty.dvTraitStates()) : objects;
    };

    var _BattleManager_makeRewards = BattleManager.makeRewards;
    BattleManager.makeRewards = function() {
        _BattleManager_makeRewards.call(this);
        var bonus = $gameParty.dvTraitSum('Золото');
        if (bonus) {
            this._rewards.gold = Math.round(this._rewards.gold * (1 + bonus / 100));
        }
    };

    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        _Game_Interpreter_pluginCommand.call(this, command, args);
        if (command === 'DV_TRAIT') {
            var id = Number(args[1]);
            if (args[0] === 'add') {
                $gameParty.dvAddTrait(id);
            } else if (args[0] === 'remove') {
                $gameParty.dvRemoveTrait(id);
            }
        }
    };
})();
