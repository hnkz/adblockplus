/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

/**
 * Initialization function, called when the window is loaded.
 */
function init()
{
  new ListManager(E("subscriptions"), E("subscriptionTemplate"), RegularSubscription, SubscriptionActions.updateCommands);
  new ListManager(E("groups"), E("groupTemplate"), SpecialSubscription, SubscriptionActions.updateCommands);
  E("filtersTree").view = FiltersView;
}

/**
 * Called whenever the currently selected tab changes.
 */
function onTabChange(/**Element*/ tabbox)
{
  SubscriptionActions.updateCommands();
  updateSelectedSubscription();

  Utils.runAsync(function()
  {
    let panel = tabbox.selectedPanel;
    if (panel)
      panel.getElementsByClassName("initialFocus")[0].focus();
  });
}

/**
 * Called whenever the selected subscription changes.
 */
function onSelectionChange(/**Element*/ list)
{
  SubscriptionActions.updateCommands();
  updateSelectedSubscription();
  list.focus();

  // Take elements of the previously selected item out of the tab order
  if ("previousSelection" in list && list.previousSelection)
  {
    let elements = list.previousSelection.getElementsByClassName("tabable");
    for (let i = 0; i < elements.length; i++)
      elements[i].setAttribute("tabindex", "-1");
  }
  // Put elements of the selected item into tab order
  if (list.selectedItem)
  {
    let elements = list.selectedItem.getElementsByClassName("tabable");
    for (let i = 0; i < elements.length; i++)
      elements[i].removeAttribute("tabindex");
  }
  list.previousSelection = list.selectedItem;
}

/**
 * Called whenever the filters list is shown/hidden.
 */
function onShowHideFilters()
{
  if (FiltersView.visible)
    FiltersView.refresh();
}

/**
 * Updates filter list when selected subscription changes.
 */
function updateSelectedSubscription()
{
  let panel = E("tabs").selectedPanel;
  if (!panel)
    return;

  let list = panel.getElementsByTagName("richlistbox")[0];
  if (!list)
    return;

  let data = Templater.getDataForNode(list.selectedItem);
  FiltersView.subscription = (data ? data.subscription : null);
}

/**
 * Template processing functions.
 * @class
 */
var Templater =
{
  /**
   * Processes a template node using given data object.
   */
  process: function(/**Node*/ template, /**Object*/ data) /**Node*/
  {
    // Use a sandbox to resolve attributes (for convenience, not security)
    let sandbox = Cu.Sandbox(window);
    for (let key in data)
      sandbox[key] = data[key];
    sandbox.formatTime = Utils.formatTime;

    // Clone template but remove id/hidden attributes from it
    let result = template.cloneNode(true);
    result.removeAttribute("id");
    result.removeAttribute("hidden");
    result._data = data;

    // Resolve any attributes of the for attr="{obj.foo}"
    let conditionals = [];
    let nodeIterator = document.createNodeIterator(result, NodeFilter.SHOW_ELEMENT, null, false);
    for (let node = nodeIterator.nextNode(); node; node = nodeIterator.nextNode())
    {
      if (node.localName == "if")
        conditionals.push(node);
      for (let i = 0; i < node.attributes.length; i++)
      {
        let attribute = node.attributes[i];
        let len = attribute.value.length;
        if (len >= 2 && attribute.value[0] == "{" && attribute.value[len - 1] == "}")
          attribute.value = Cu.evalInSandbox(attribute.value.substr(1, len - 2), sandbox);
      }
    }

    // Process <if> tags - remove if condition is false, replace by their children
    // if it is true
    for each (let node in conditionals)
    {
      let fragment = document.createDocumentFragment();
      let condition = node.getAttribute("condition");
      if (condition == "false")
        condition = false;
      for (let i = 0; i < node.childNodes.length; i++)
      {
        let child = node.childNodes[i];
        if (child.localName == "elif" || child.localName == "else")
        {
          if (condition)
            break;
          condition = (child.localName == "elif" ? child.getAttribute("condition") : true);
          if (condition == "false")
            condition = false;
        }
        else if (condition)
          fragment.appendChild(node.childNodes[i--]);
      }
      node.parentNode.replaceChild(fragment, node);
    }

    return result;
  },

  /**
   * Updates first child of a processed template if the underlying data changed.
   */
  update: function(/**Node*/ template, /**Node*/ node)
  {
    if (!("_data" in node))
      return;
    let newChild = Templater.process(template.firstChild, node._data);
    delete newChild._data;
    node.replaceChild(newChild, node.firstChild);
  },

  /**
   * Walks up the parent chain for a node until the node corresponding with a
   * template is found.
   */
  getDataNode: function(/**Node*/ node) /**Node*/
  {
    while (node)
    {
      if ("_data" in node)
        return node;
      node = node.parentNode;
    }
    return null;
  },

  /**
   * Returns the data used to generate the node from a template.
   */
  getDataForNode: function(/**Node*/ node) /**Object*/
  {
    node = Templater.getDataNode(node);
    if (node)
      return node._data;
    else
      return null;
  },

  /**
   * Returns a node that has been generated from a template using a particular
   * data object.
   */
  getNodeForData: function(/**Node*/ parent, /**String*/ property, /**Object*/ data) /**Node*/
  {
    for (let child = parent.firstChild; child; child = child.nextSibling)
      if ("_data" in child && property in child._data && child._data[property] == data)
        return child;
    return null;
  }
};

/**
 * Fills a list of filter groups and keeps it updated.
 * @param {Element} list  richlistbox element to be filled
 * @param {Node} template  template to use for the groups
 * @param {Object} classFilter  base class of the groups to display
 * @param {Function} listener  function to be called on changes
 * @constructor
 */
function ListManager(list, template, classFilter, listener)
{
  this._list = list;
  this._template = template;
  this._classFilter = classFilter;
  this._listener = listener || function(){};

  this._placeholder = this._list.firstChild;
  this._list.removeChild(this._placeholder);

  this._list.listManager = this;
  this.reload();

  let me = this;
  let proxy = function()
  {
    return me._onChange.apply(me, arguments);
  };
  FilterNotifier.addListener(proxy);
  window.addEventListener("unload", function()
  {
    FilterNotifier.removeListener(proxy);
  }, false);
}
ListManager.prototype =
{
  /**
   * List element being managed.
   * @type Element
   */
  _list: null,
  /**
   * Template used for the groups.
   * @type Node
   */
  _template: null,
  /**
   * Base class of the groups to display.
   */
  _classFilter: null,
  /**
   * Function to be called whenever list contents change.
   * @type Function
   */
  _listener: null,
  /**
   * Entry to display if the list is empty (if any).
   * @type Element
   */
  _placeholder: null,

  /**
   * Completely rebuilds the list.
   */
  reload: function()
  {
    // Remove existing entries if any
    while (this._list.firstChild)
      this._list.removeChild(this._list.firstChild);

    // Now add all subscriptions
    let subscriptions = FilterStorage.subscriptions.filter(function(subscription) subscription instanceof this._classFilter, this);
    if (subscriptions.length)
    {
      for each (let subscription in subscriptions)
        this.addSubscription(subscription, null);

      // Make sure first list item is selected after list initialization
      Utils.runAsync(function()
      {
        this._list.selectItem(this._list.getItemAtIndex(this._list.getIndexOfFirstVisibleRow()));
      }, this);
    }
    else if (this._placeholder)
      this._list.appendChild(this._placeholder);
    this._listener();
  },

  /**
   * Adds a filter subscription to the list.
   */
  addSubscription: function(/**Subscription*/ subscription, /**Node*/ insertBefore) /**Node*/
  {
    let node = Templater.process(this._template, {
      __proto__: null,
      subscription: subscription,
      isExternal: subscription instanceof ExternalSubscription,
      downloading: Synchronizer.isExecuting(subscription.url)
    });
    if (insertBefore)
      this._list.insertBefore(node, insertBefore);
    else
      this._list.appendChild(node);
    return node;
  },

  /**
   * Subscriptions change processing.
   * @see FilterNotifier.addListener()
   */
  _onChange: function(action, item, newValue, oldValue)
  {
    if (/^subscription\./.test(action) && !(item instanceof this._classFilter))
      return;

    switch (action)
    {
      case "subscription.add":
      {
        let index = FilterStorage.subscriptions.indexOf(item);
        if (index >= 0)
        {
          let insertBefore = null;
          for (index++; index < FilterStorage.subscriptions.length && !insertBefore; index++)
            insertBefore = Templater.getNodeForData(this._list, "subscription", FilterStorage.subscriptions[index]);
          this.addSubscription(item, insertBefore);
          if (this._placeholder.parentNode)
            this._placeholder.parentNode.removeChild(this._placeholder);
          this._listener();
        }
        break;
      }
      case "subscription.remove":
      {
        let node = Templater.getNodeForData(this._list, "subscription", item);
        if (node)
        {
          let newSelection = node.nextSibling || node.previousSibling;
          node.parentNode.removeChild(node);
          if (!this._list.firstChild)
          {
            this._list.appendChild(this._placeholder);
            this._list.selectedItem = this._placeholder;
          }
          else if (newSelection)
          {
            this._list.ensureElementIsVisible(newSelection);
            this._list.selectedItem = newSelection;
          }
          this._listener();
        }
        break
      }
      case "subscription.move":
      {
        let node = Templater.getNodeForData(this._list, "subscription", item);
        if (node)
        {
          node.parentNode.removeChild(node);
          let insertBefore = null;
          let index = FilterStorage.subscriptions.indexOf(item);
          if (index >= 0)
            for (index++; index < FilterStorage.subscriptions.length && !insertBefore; index++)
              insertBefore = Templater.getNodeForData(this._list, "subscription", FilterStorage.subscriptions[index]);
          this._list.insertBefore(node, insertBefore);
          this._list.ensureElementIsVisible(node);
          this._listener();
        }
        break;
      }
      case "subscription.title":
      case "subscription.disabled":
      case "subscription.homepage":
      case "subscription.lastDownload":
      case "subscription.downloadStatus":
      {
        let subscriptionNode = Templater.getNodeForData(this._list, "subscription", item);
        if (subscriptionNode)
        {
          Templater.getDataForNode(subscriptionNode).downloading = Synchronizer.isExecuting(item.url);
          Templater.update(this._template, subscriptionNode);

          if (!document.commandDispatcher.focusedElement)
            this._list.focus();
          this._listener();
        }
        break;
      }
    }
  }
};

/**
 * Implemetation of the various actions that can be performed on subscriptions.
 * @class
 */
var SubscriptionActions =
{
  /**
   * Returns the subscription list currently having focus if any.
   * @type Element
   */
  get focusedList()
  {
    let focused = document.commandDispatcher.focusedElement;
    while (focused)
    {
      if ("listManager" in focused)
        return focused;
      focused = focused.parentNode;
    }
    return null;
  },

  /**
   * Returns the currently selected and focused subscription item if any.
   * @type Element
   */
  get selectedItem()
  {
    let list = this.focusedList;
    return (list ? list.selectedItem : null);
  },

  /**
   * Updates subscription commands whenever the selected subscription changes.
   * Note: this method might be called with a wrong "this" value.
   */
  updateCommands: function()
  {
    let node = SubscriptionActions.selectedItem;
    let data = Templater.getDataForNode(node);
    let subscription = (data ? data.subscription : null)
    E("subscription-update-command").setAttribute("disabled", !subscription ||
        !(subscription instanceof DownloadableSubscription) ||
        Synchronizer.isExecuting(subscription.url));
    E("subscription-moveUp-command").setAttribute("disabled", !subscription ||
        !node || !node.previousSibling || !!node.previousSibling.id);
    E("subscription-moveDown-command").setAttribute("disabled", !subscription ||
        !node || !node.nextSibling || !!node.nextSibling.id);
  },

  /**
   * Starts title editing for the selected subscription.
   */
  editTitle: function()
  {
    let node = this.selectedItem;
    if (node)
      TitleEditor.start(node);
  },

  /**
   * Triggers re-download of a filter subscription.
   */
  updateFilters: function(/**Node*/ node)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data && data.subscription instanceof DownloadableSubscription)
      Synchronizer.execute(data.subscription, true, true);
  },

  /**
   * Sets Subscription.disabled field to a new value.
   */
  setDisabled: function(/**Element*/ node, /**Boolean*/ value)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data)
      data.subscription.disabled = value;
  },

  /**
   * Removes a filter subscription from the list (after a warning).
   */
  remove: function(/**Node*/ node)
  {
    let data = Templater.getDataForNode(node || this.selectedItem);
    if (data && Utils.confirm(window, Utils.getString("remove_subscription_warning")))
      FilterStorage.removeSubscription(data.subscription);
  },

  /**
   * Adds a new filter group and allows the user to change its title.
   */
  addGroup: function()
  {
    let subscription = SpecialSubscription.create();
    FilterStorage.addSubscription(subscription);

    let list = E("groups");
    let node = Templater.getNodeForData(list, "subscription", subscription);
    if (node)
    {
      list.focus();
      list.ensureElementIsVisible(node);
      list.selectedItem = node;
      this.editTitle();
    }
  },

  /**
   * Moves a filter subscription one line up.
   */
  moveUp: function(/**Node*/ node)
  {
    node = Templater.getDataNode(node || this.selectedItem);
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    let previousData = Templater.getDataForNode(node.previousSibling);
    if (!previousData)
      return;

    FilterStorage.moveSubscription(data.subscription, previousData.subscription);
  },

  /**
   * Moves a filter subscription one line down.
   */
  moveDown: function(/**Node*/ node)
  {
    node = Templater.getDataNode(node || this.selectedItem);
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    let nextNode = node.nextSibling;
    if (!Templater.getDataForNode(nextNode))
      return;

    let nextData = Templater.getDataForNode(nextNode.nextSibling);
    FilterStorage.moveSubscription(data.subscription, nextData ? nextData.subscription : null);
  },

  /**
   * Opens the context menu for a subscription node.
   */
  openMenu: function(/**Event*/ event, /**Node*/ node)
  {
    node.getElementsByClassName("actionMenu")[0].openPopup(null, "after_pointer", event.clientX, event.clientY, true, false, event);
  },

  _altMask: 2,
  _ctrlMask: 4,
  _metaMask: 8,
  get _accelMask()
  {
    let result = this._ctrlMask;
    try {
      let accelKey = Utils.prefService.getIntPref("ui.key.accelKey");
      if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_META)
        result = this._metaMask;
      else if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_ALT)
        result = this._altMask;
    } catch(e) {}
    this.__defineGetter__("_accelMask", function() result);
    return result;
  },

  /**
   * Called when a key is pressed on the subscription list.
   */
  keyPress: function(/**Event*/ event)
  {
    let modifiers = 0;
    if (event.altKey)
      modifiers |= this._altMask;
    if (event.ctrlKey)
      modifiers |= this._ctrlMask;
    if (event.metaKey)
      modifiers |= this._metaMask;

    if (event.charCode == Ci.nsIDOMKeyEvent.DOM_VK_SPACE && modifiers == 0)
    {
      let data = Templater.getDataForNode(this.selectedItem);
      if (data)
        data.subscription.disabled = !data.subscription.disabled;
    }
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_UP && modifiers == this._accelMask)
    {
      E("subscription-moveUp-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
    else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_DOWN && modifiers == this._accelMask)
    {
      E("subscription-moveDown-command").doCommand();
      event.preventDefault();
      event.stopPropagation();
    }
  },

  /**
   * Subscription currently being dragged if any.
   * @type Subscription
   */
  dragSubscription: null,

  /**
   * Called when a subscription entry is dragged.
   */
  startDrag: function(/**Event*/ event, /**Node*/ node)
  {
    let data = Templater.getDataForNode(node);
    if (!data)
      return;

    event.dataTransfer.setData("text/x-moz-url", data.subscription.url);
    event.dataTransfer.setData("text/plain", data.subscription.title);
    this.dragSubscription = data.subscription;
    event.stopPropagation();
  },

  /**
   * Called when something is dragged over a subscription entry or subscriptions list.
   */
  dragOver: function(/**Event*/ event)
  {
    // Ignore if not dragging a subscription
    if (!this.dragSubscription)
      return;

    // Don't allow dragging onto a scroll bar
    for (let node = event.originalTarget; node; node = node.parentNode)
      if (node.localName == "scrollbar")
        return;

    // Don't allow dragging onto element's borders
    let target = event.originalTarget;
    while (target && target.localName != "richlistitem")
      target = target.parentNode;
    if (!target)
      target = event.originalTarget;

    let styles = window.getComputedStyle(target, null);
    let rect = target.getBoundingClientRect();
    if (event.clientX < rect.left + parseInt(styles.borderLeftWidth, 10) ||
        event.clientY < rect.top + parseInt(styles.borderTopWidth, 10) ||
        event.clientX > rect.right - parseInt(styles.borderRightWidth, 10) - 1 ||
        event.clientY > rect.bottom - parseInt(styles.borderBottomWidth, 10) - 1)
    {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  },

  /**
   * Called when something is dropped on a subscription entry or subscriptions list.
   */
  drop: function(/**Event*/ event, /**Node*/ node)
  {
    if (!this.dragSubscription)
      return;

    // When dragging down we need to insert after the drop node, otherwise before it.
    node = Templater.getDataNode(node);
    if (node)
    {
      let dragNode = Templater.getNodeForData(node.parentNode, "subscription", this.dragSubscription);
      if (node.compareDocumentPosition(dragNode) & node.DOCUMENT_POSITION_PRECEDING)
        node = node.nextSibling;
    }

    let data = Templater.getDataForNode(node);
    FilterStorage.moveSubscription(this.dragSubscription, data ? data.subscription : null);
    event.stopPropagation();
  },

  /**
   * Called when the drag operation for a subscription is finished.
   */
  endDrag: function()
  {
    this.dragSubscription = null;
  }
};

/**
 * Subscription title editing functionality.
 * @class
 */
var TitleEditor =
{
  /**
   * List item corresponding with the currently edited subscription if any.
   * @type Node
   */
  subscriptionEdited: null,

  /**
   * Starts editing of a subscription title.
   * @param {Node} node subscription list entry or a child node
   * @param {Boolean} [checkSelection] if true the editor will not start if the
   *        item was selected in the preceding mousedown event
   */
  start: function(node, checkSelection)
  {
    if (this.subscriptionEdited)
      this.end(true);

    let subscriptionNode = Templater.getDataNode(node);
    if (!subscriptionNode || (checkSelection && !subscriptionNode._wasSelected))
      return;

    subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 1;
    let editor = subscriptionNode.getElementsByClassName("titleEditor")[0];
    editor.value = Templater.getDataForNode(subscriptionNode).subscription.title;
    editor.setSelectionRange(0, editor.value.length);
    this.subscriptionEdited = subscriptionNode;
    editor.focus();
  },

  /**
   * Stops editing of a subscription title.
   * @param {Boolean} save if true the entered value will be saved, otherwise dismissed
   */
  end: function(save)
  {
    if (!this.subscriptionEdited)
      return;

    let subscriptionNode = this.subscriptionEdited;
    this.subscriptionEdited = null;

    let newTitle = null;
    if (save)
    {
      newTitle = subscriptionNode.getElementsByClassName("titleEditor")[0].value;
      newTitle = newTitle.replace(/^\s+/, "").replace(/\s+$/, "");
    }

    let subscription = Templater.getDataForNode(subscriptionNode).subscription
    if (newTitle && newTitle != subscription.title)
      subscription.title = newTitle;
    else
    {
      subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 0;
      subscriptionNode.parentNode.focus();
    }
  },

  /**
   * Processes keypress events on the subscription title editor field.
   */
  keyPress: function(/**Event*/ event)
  {
    // Prevent any key presses from triggering outside actions
    event.stopPropagation();

    if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
    {
      event.preventDefault();
      this.end(true);
    }
    else if (event.keyCode == event.DOM_VK_CANCEL || event.keyCode == event.DOM_VK_ESCAPE)
    {
      event.preventDefault();
      this.end(false);
    }
  }
};

/**
 * Methods called when choosing and adding a new filter subscription.
 * @class
 */
var SelectSubscription =
{
  /**
   * Starts selection of a filter subscription to add.
   */
  start: function(/**Event*/ event)
  {
    let panel = E("selectSubscriptionPanel");
    let list = E("selectSubscription");
    let template = E("selectSubscriptionTemplate");
    let parent = list.menupopup;

    if (panel.state == "open")
    {
      list.focus();
      return;
    }

    // Remove existing entries if any
    while (parent.lastChild)
      parent.removeChild(parent.lastChild);

    // Load data
    let request = new XMLHttpRequest();
    request.open("GET", "subscriptions.xml");
    request.onload = function()
    {
      // Avoid race condition if two downloads are started in parallel
      if (panel.state == "open")
        return;

      // Add subscription entries to the list
      let subscriptions = request.responseXML.getElementsByTagName("subscription");
      let listedSubscriptions = [];
      for (let i = 0; i < subscriptions.length; i++)
      {
        let subscription = subscriptions[i];
        let url = subscription.getAttribute("url");
        if (!url || url in FilterStorage.knownSubscriptions)
          continue;

        let localePrefix = Utils.checkLocalePrefixMatch(subscription.getAttribute("prefixes"));
        let node = Templater.process(template, {
          __proto__: null,
          node: subscription,
          localePrefix: localePrefix
        });
        parent.appendChild(node);
        listedSubscriptions.push(subscription);
      }
      let selectedNode = Utils.chooseFilterSubscription(listedSubscriptions);
      list.selectedItem = Templater.getNodeForData(parent, "node", selectedNode) || parent.firstChild;

      // Show panel and focus list
      let position = (Utils.versionComparator.compare(Utils.platformVersion, "2.0") < 0 ? "after_end" : "bottomcenter topleft");
      panel.openPopup(E("selectSubscriptionButton"), position, 0, 0, false, false, event);
      Utils.runAsync(list.focus, list);
    };
    request.send();
  },

  /**
   * Adds filter subscription that is selected.
   */
  add: function()
  {
    E("selectSubscriptionPanel").hidePopup();

    let data = Templater.getDataForNode(E("selectSubscription").selectedItem);
    if (!data)
      return;

    let subscription = Subscription.fromURL(data.node.getAttribute("url"));
    if (!subscription)
      return;

    FilterStorage.addSubscription(subscription);
    subscription.disabled = false;
    subscription.title = data.node.getAttribute("title");
    subscription.homepage = data.node.getAttribute("homepage");

    // Make sure the subscription is visible and selected
    let list = E("subscriptions");
    let node = Templater.getNodeForData(list, "subscription", subscription);
    if (node)
    {
      list.ensureElementIsVisible(node);
      list.selectedItem = node;
      list.focus();
    }

    // Trigger download if necessary
    if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
      Synchronizer.execute(subscription);
    FilterStorage.saveToDisk();
  },

  /**
   * Called if the user chooses to view the complete subscriptions list.
   */
  chooseOther: function()
  {
    E("selectSubscriptionPanel").hidePopup();
    window.openDialog("subscriptionSelection.xul", "_blank", "chrome,centerscreen,modal,resizable,dialog=no", null, null);
  },

  /**
   * Called for keys pressed on the subscription selection panel.
   */
  keyPress: function(/**Event*/ event)
  {
    // Buttons and text links handle Enter key themselves
    if (event.target.localName == "button" || event.target.localName == "label")
      return;

    if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
    {
      // This shouldn't accept our dialog, only the panel
      event.preventDefault();
      E("selectSubscriptionAccept").doCommand();
    }
  }
};

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

/**
 * nsITreeView implementation to display filters of a particular filter
 * subscription.
 * @class
 */
var FiltersView =
{
  /**
   * Box object of the tree that this view is attached to.
   * @type nsITreeBoxObject
   */
  boxObject: null,

  /**
   * "Filter" to be displayed if no filter group is selected.
   */
  noGroupDummy: null,

  /**
   * Map of used cell properties to the corresponding nsIAtom representations.
   */
  atoms: null,

  /**
   * "Filter" to be displayed if the selected group is empty.
   */
  noFiltersDummy: null,

  /**
   * Displayed list of filters, might be sorted.
   * @type Filter[]
   */
  data: [],

  /**
   * Tests whether the tree is currently visible.
   */
  get visible()
  {
    return this.boxObject && !this.boxObject.treeBody.parentNode.collapsed;
  },

  _subscription: 0,

  /**
   * Filter subscription being displayed.
   * @type Subscription
   */
  get subscription() this._subscription,
  set subscription(value)
  {
    if (value == this._subscription)
      return;

    this._subscription = value;
    if (this.visible)
      this.refresh();
  },

  /**
   * Updates internal view data after a filter subscription change.
   */
  refresh: function()
  {
    let oldCount = this.rowCount;
    if (this._subscription)
    {
      if (this._subscription.filters.length)
        this.data = this._subscription.filters.slice();
      else
        this.data = [this.noFiltersDummy]
    }
    else
      this.data = [this.noGroupDummy];

    this.boxObject.rowCountChanged(0, -oldCount);
    this.boxObject.rowCountChanged(0, this.rowCount);
    if (this.rowCount)
      this.selection.select(0);
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsITreeView]),

  setTree: function(boxObject)
  {
    this.boxObject = boxObject;
    if (this.boxObject)
    {
      this.noGroupDummy = {text: this.boxObject.treeBody.getAttribute("noGroupText"), dummy: true};
      this.noFiltersDummy = {text: this.boxObject.treeBody.getAttribute("noFiltersText"), dummy: true};
    }

    let atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
    let stringAtoms = ["col-filter", "col-enabled", "col-hitcount", "col-lasthit", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
    let boolAtoms = ["selected", "dummy", "slow", "disabled"];

    this.atoms = {};
    for each (let atom in stringAtoms)
      this.atoms[atom] = atomService.getAtom(atom);
    for each (let atom in boolAtoms)
    {
      this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
      this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
    }
  },

  selection: null,

  get rowCount() this.data.length,

  getCellText: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return null;

    col = col.id;
    if (col != "col-filter" && col != "col-slow" && col != "col-hitcount" && col != "col-lasthit")
      return null;

    let filter = this.data[row];
    if (col == "col-filter")
      return filter.text;
    else if (col == "col-slow")
      return (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter) ? "!" : null);
    else if (filter instanceof ActiveFilter)
    {
      if (col == "col-hitcount")
        return filter.hitCount;
      else
        return (filter.lastHit ? Utils.formatTime(filter.lastHit) : null);
    }
    else
      return null;
  },

  getColumnProperties: function(col, properties)
  {
    col = col.id;

    if (col in this.atoms)
      properties.AppendElement(this.atoms[col]);
  },

  getRowProperties: function(row, properties)
  {
    if (row < 0 || row >= this.data.length)
      return;

    let filter = this.data[row];
    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["slow-" + (filter instanceof RegExpFilter && defaultMatcher.isSlowFilter(filter))]);
    if (filter instanceof ActiveFilter)
      properties.AppendElement(this.atoms["disabled-" + filter.disabled]);
    properties.AppendElement(this.atoms["dummy-" + ("dummy" in filter)]);

    if (filter instanceof CommentFilter)
      properties.AppendElement(this.atoms["type-comment"]);
    else if (filter instanceof BlockingFilter)
      properties.AppendElement(this.atoms["type-filterlist"]);
    else if (filter instanceof WhitelistFilter)
      properties.AppendElement(this.atoms["type-whitelist"]);
    else if (filter instanceof ElemHideFilter)
      properties.AppendElement(this.atoms["type-elemhide"]);
    else if (filter instanceof InvalidFilter)
      properties.AppendElement(this.atoms["type-invalid"]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  cycleHeader: function(col)
  {
    // TODO
  },

  isSorted: function()
  {
    // TODO
    return false;
  },

  canDrop: function(row, orientation)
  {
    // TODO
    return false;
  },

  drop: function(row, orientation)
  {
    // TODO
  },

  isEditable: function(row, col)
  {
    if (row < 0 || row >= this.data.length)
      return null;

    let filter = this.data[row];
    if (col.id == "col-filter")
      return !("dummy" in filter);
    else
      return false;
  },

  setCellText: function(row, col, value)
  {
    // TODO
  },

  cycleCell: function(row, col)
  {
    // TODO
  },

  isContainer: function(row) false,
  isContainerOpen: function(row) false,
  isContainerEmpty: function(row) true,
  getLevel: function(row) 0,
  getParentIndex: function(row) -1,
  hasNextSibling: function(row, afterRow) false,
  toggleOpenState: function(row) {},
  getProgressMode: function() null,
  getImageSrc: function() null,
  isSeparator: function() false,
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  getCellValue: function() null,
  setCellValue: function() {},
  selectionChanged: function() {},
};
