var proto = require("proto")
var EventEmitter = require("events").EventEmitter
var utils = require("./utils")


// emits the event:
    // change - the event data is an object of one of the following forms:
        // {id:_, type: 'set', property: propertyList}
        // {id:_, type: 'added', property: propertyList, index:_, count: numberOfElementsAdded}
        // {id:_, type: 'removed', property: propertyList, index:_, values: removedValues}
var Observe = module.exports = proto(EventEmitter, function() {

    // static members

    this.init = function(obj) {
        this.subject = obj

        this.setMaxListeners(1000)
    }

    // instance members

    // gets an element or member of the subject and returns another Observee
    // changes to the returned Observee will be emitted by its parent as well
    this.get = function(property) {
        return ObserveeChild(this, parsePropertyList(property))
    }

    // sets a value on the subject
    // property - either an array of members to select, or a string where properties to select are separated by dots
    // value - the value to set
    this.set = function(property, value) {
        setInternal(this, parsePropertyList(property), value, {})
    }

    // pushes a value onto a list
    this.push = function(/*value...*/) {
        pushInternal(this, [], arguments, {})
    }


    // index is the index to remove/insert at
    // countToRemove is the number to remove
    // elementsToAdd is a list of elements to add
    this.splice = function(/*index, countToRemove[, elementsToAdd]*/) {
        return spliceInternal(this, [], arguments, {})
    }

    // use this instead of concat for mutation behavior
    this.append = function(arrayToAppend) {
        appendInternal(this, [], arguments, {})
    }

    this.id = function(id) {
        return ObserveeChild(this, [], {id: id})
        //return idFunction(this, [], id)
    }

    // For the returned object, any property added via set, push, splice, or append joins an internal observee together with this observee, so that
    //      the internal observee and the containing observee will both send 'change' events appropriately
    // collapse - (default: false) if true, any property added will be set to the subject of the value added (so that value won't be an observee anymore
        // note: only use collapse:true if the observees you're unioning isn't actually an object that inherits from an observee - any instance methods on the observee that come from child classes won't be accessible anymore
        // e.g. var x = observe({a:5})
        //      var b = observe({})
        //      x.subject.a === 5    ;; true
        //      b.union(true).set('x', x)
        //      b.subject.x.a === 5            ;; true
        //      b.subject.x.subject.a === 5    ;; false
    this.union = function(collapse) {
        if(collapse === undefined) collapse = false
        return ObserveeChild(this, [], {union: collapse})
    }


    /* pause and unpause may cause weird affects in certain cases (e.g. if you remove an element at index 4 and *then* add an element at index 2)
    // pause sending events (for when you want to do a lot of things to an object)
    this.pause = function() {
        this.paused = true
    }
    this.unpause = function() {
        this.paused = undefined
        sendEvent(this)
    }*/
})


function parsePropertyList(property) {
    if(!(property instanceof Array)) {
        property = property.toString().split('.')
    }

    return property
}

function getPropertyPointer(subject, propertyList) {
    var current = subject
    for(var n=0; n<propertyList.length-1; n++) {
        current = current[propertyList[n]]
    }

    return {obj: current, key:propertyList[n]}
}

var getPropertyValue = module.exports.getPropertyValue = function(subject, property) {
    var pointer = getPropertyPointer(subject, property)
    if(pointer.key !== undefined) {
        return pointer.obj[pointer.key]
    } else {
        return pointer.obj
    }
}

// private

// options can have the properties:
    // union - if true, any value set, pushed, appended, or spliced onto the observee is unioned
var ObserveeChild = proto(EventEmitter, function() {

    this.init = function(parent, propertyList, options) {
        if(options === undefined) this.options = {}
        else                      this.options = options

        if(parent._observeeParent !== undefined)
            this._observeeParent = parent._observeeParent
        else
            this._observeeParent = parent

        this.property = propertyList
        this.subject = getPropertyValue(parent.subject, propertyList)

        var that = this
        parent.on('change', function(change) {
            var answers = changeQuestions(that.property, change)

            if(answers.isWithin ) {
                that.emit('change', {type:change.type, property: change.property.slice(that.property.length), index:change.index, count:change.count, removed: change.removed})
            } else if(answers.couldRelocate) {
                if(change.type === 'removed') {
                    var relevantIndex = that.property[change.property.length]
                    var removedIndexesAreBeforeIndexOfObserveeChild = change.index + change.removed.length - 1 < relevantIndex

                    if(removedIndexesAreBeforeIndexOfObserveeChild) {
                        that.property[change.property.length] = relevantIndex - change.removed.length // change the propertyList to match the new index
                    }
                } else if(change.type === 'added') {
                    var relevantIndex = that.property[change.property.length]
                    if(change.index < relevantIndex) {
                        that.property[change.property.length] = relevantIndex + change.count // change the propertyList to match the new index
                    }
                }
            }
        })
    }

    this.get = function(property) {
        return this._observeeParent.get(this.property.concat(parsePropertyList(property)))
    }

    this.set = function(property, value) {
        setInternal(this._observeeParent, this.property.concat(parsePropertyList(property)), value, this.options)
    }

    this.push = function(/*values...*/) {
        pushInternal(this._observeeParent, this.property, arguments, this.options)
    }

    this.splice = function(index, countToRemove/*[, elementsToAdd....]*/) {
        spliceInternal(this._observeeParent, this.property, arguments, this.options)
    }

    this.append = function(/*[property,] arrayToAppend*/) {
        appendInternal(this._observeeParent, this.property, arguments, this.options)
    }

    this.id = function(id) {
        return ObserveeChild(this, this.property, utils.merge({}, this.options, {id: id}))
        //return idFunction(this._observeeParent, this.property, id)
    }

    this.union = function(collapse) {
        if(collapse === undefined) collapse = false
        return ObserveeChild(this, [], utils.merge({}, this.options, {union: collapse}))
    }

})

     /*
function idFunction(that, propertyList, id) {
    var result = {
        set: function(property, value) {
            var fullPropertyList = propertyList.concat(parsePropertyList(property))
            setInternal(that, fullPropertyList, value, id)
        },
        push: function() {
            pushInternal(that, propertyList, arguments, id)
        },
        splice: function() {
            spliceInternal(that, propertyList, arguments, id)
        },
        append: function() {
            appendInternal(that, propertyList, arguments, id)
        },
        get: function() {

        }
    }
}
*/

// that - the Observee object
function setInternal(that, propertyList, value, options) {
    var pointer = getPropertyPointer(that.subject, propertyList)

    var internalObservee = value
    if(options.union === true) {
        value = value.subject
    }

    pointer.obj[pointer.key] = value

    var event = {type: 'set', property: propertyList}
    if(options.id !== undefined) event.id = options.id
    that.emit('change',event)

    if(options.union !== undefined)
        unionizeEvents(that, internalObservee, propertyList, options.union)
}

function pushInternal(that, propertyList, args, options) {
    var array = getPropertyValue(that.subject, propertyList)
    var originalLength = array.length
    array.push.apply(array, args)

    var internalObservees = unionizeList(array, originalLength, args.length, options.union)

    var event = {type: 'added', property: propertyList, index: originalLength, count: 1}
    if(options.id !== undefined) event.id = options.id
    that.emit('change', event)

    unionizeListEvents(that, internalObservees, propertyList, options.union)
}

function spliceInternal(that, propertyList, args, options) {
    var index = args[0]
    var countToRemove = args[1]

    var array = getPropertyValue(that.subject, propertyList)
    var result = array.splice.apply(array, args)

    if(countToRemove > 0) {
        var event = {type: 'removed', property: propertyList, index: index, removed: result}
        if(options.id !== undefined) event.id = options.id
        that.emit('change', event)
    }
    if(args.length > 2) {
        var event = {type: 'added', property: propertyList, index: index, count: args.length-2}

        var internalObservees = unionizeList(array, index, event.count, options.union)

        if(options.id !== undefined) event.id = options.id
        that.emit('change', event)

        unionizeListEvents(that, internalObservees, propertyList, options.union)
    }

    return result
}

// note: I'm not using splice to do this as an optimization (because otherwise the property list would have to be parsed twice and the value gotten twice) - maybe this optimization wasn't worth it but its already done
function appendInternal(that, propertyList, args, options) {
    var arrayToAppend = args[0]
    if(arrayToAppend.length === 0) return; //nothing to do

    var array = getPropertyValue(that.subject, propertyList)
    var originalLength = array.length

    var spliceArgs = [originalLength, 0]
    spliceArgs = spliceArgs.concat(arrayToAppend)
    var oldLength = array.length
    array.splice.apply(array, spliceArgs)

    var internalObservees = unionizeList(array, oldLength, array.length, options.union)

    var event = {type: 'added', property: propertyList, index: originalLength, count: arrayToAppend.length}
    if(options.id !== undefined) event.id = options.id
    that.emit('change', event)

    unionizeListEvents(that, internalObservees, propertyList, options.union)
}

// sets a slice of elements to their subjects and
// returns the original observee objects along with their indexes
function unionizeList(array, start, count, union) {
    var internalObservees = [] // list of observees and their property path
    if(union !== undefined) {
        var afterEnd = start+count
        for(var n=start; n<afterEnd; n++) {
            internalObservees.push({obj: array[n], index: n})
            if(union === true)
                array[n] = array[n].subject
        }
    }

    return internalObservees
}

// runs unionizeEvents for elements in a list
// internalObservees should be the result from `unionizeList`
function unionizeListEvents(that, internalObservees, propertyList, collapse) {
    for(var n=0; n<internalObservees.length; n++) {
        unionizeEvents(that, internalObservees[n].obj, propertyList.concat(internalObservees[n].index), collapse)
    }
}


// sets up the union change events for an observee with one of its inner properties
// parameters:
    // that - the container observee
    // innerObservee - the contained observee
    // propertyList - the propertyList to unionize
    // collapse - the union option (true for collapse)
function unionizeEvents(that, innerObservee, propertyList, collapse) {
    var propertyListDepth = propertyList.length

    if(innerObservee.on === undefined || innerObservee.emit === undefined || innerObservee.removeListener === undefined || innerObservee.set === undefined) {
        throw new Error("Attempting to union a value that isn't an observee")
    }

    var innerChangeHandler, containerChangeHandler
    var ignorableContainerEvents = [], ignorableInnerEvents = []
    innerObservee.on('change', innerChangeHandler = function(change) {
        if(ignorableInnerEvents.indexOf(change) === -1) {        // don't run this for events generated by the union event handlers
            if(collapse) {
                var property = propertyList.concat(change.property)
            } else {
                var property = propertyList.concat(['subject']).concat(change.property)
            }

            var containerChange = utils.merge({}, change, {property: property})
            ignorableContainerEvents.push(containerChange)
            that.emit('change', containerChange)
        }
    })
    that.on('change', containerChangeHandler = function(change) {
        var changedPropertyDepth = change.property.length

        var answers = changeQuestions(propertyList, change)
        var changeIsWithinInnerProperty = answers.isWithin
        var changeCouldRelocateInnerProperty = answers.couldRelocate

        if(changeIsWithinInnerProperty && ignorableContainerEvents.indexOf(change) === -1) {   // don't run this for events generated by the union event handlers
            if(collapse) {
                var property = change.property.slice(propertyListDepth)
            } else {
                var property = change.property.slice(propertyListDepth+1) // +1 for the 'subject'
            }

            var innerObserveeEvent = utils.merge({}, change, {property: property})
            ignorableInnerEvents.push(innerObserveeEvent)
            innerObservee.emit('change', innerObserveeEvent)
        } else if(changeCouldRelocateInnerProperty) {
            if(change.type === 'set' /*&& changedPropertyDepth <= propertyListDepth  - this part already done above*/) {
                removeUnion()
            } else if(change.type === 'removed') {
                var relevantIndex = propertyList[change.property.length]
                var removedIndexesContainsIndexOfInnerObservee = change.index <= relevantIndex && relevantIndex <= change.index + change.removed.length - 1
                var removedIndexesAreBeforeIndexOfInnerObservee = change.index + change.removed.length - 1 < relevantIndex && relevantIndex

                if(removedIndexesContainsIndexOfInnerObservee && changedPropertyDepth <= propertyListDepth+1) {
                    removeUnion()
                } else if(removedIndexesAreBeforeIndexOfInnerObservee) {
                    propertyList[change.property.length] = relevantIndex - change.removed.length // change the propertyList to match the new index
                }
            } else if(change.type === 'added') {
                var relevantIndex = propertyList[change.property.length]
                if(change.index < relevantIndex) {
                    propertyList[change.property.length] = relevantIndex + change.count // change the propertyList to match the new index
                }
            }
        }
    })

    var removeUnion = function() {
        innerObservee.removeListener('change', innerChangeHandler)
        that.removeListener('change', containerChangeHandler)
    }
}


// answers certain questions about a change compared to a property list
// returns an object like: {
    // isWithin: _,           // true if changeIsWithinInnerProperty
    // couldRelocate: _       // true if changeCouldRelocateInnerProperty or if innerProperty might be removed
// }
function changeQuestions(propertyList, change) {
    var propertyListDepth = propertyList.length

    var changeIsWithinInnerProperty = true // assume true until proven otherwise
    var changeCouldRelocateInnerProperty = true // assume true until prove otherwise
    for(var n=0; n<propertyListDepth; n++) {
        if(change.property[n] !== propertyList[n]) {
            changeIsWithinInnerProperty = false
            if(n<change.property.length) {
                changeCouldRelocateInnerProperty = false
            }
        }
    }

    if(change.property.length <= propertyListDepth) {
        changeIsWithinInnerProperty = false
    } else {
        changeCouldRelocateInnerProperty = false
    }

    return {couldRelocate: changeCouldRelocateInnerProperty, isWithin: changeIsWithinInnerProperty}
}