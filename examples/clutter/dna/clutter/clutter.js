// These are the Exposed a functions which are visible to the UI so it can be called via localhost, web browser, or socket
function getProperty(name) {            // The definition of the function you intend to expose
    return property(name);              // Retrieves a property of the holochain from the DNA (e.g., Name, Language
}


function appProperty(name) {            // The definition of the function you intend to expose
    if (name == "App_Agent_Hash") {return App.Agent.Hash;}
    if (name == "App_Agent_String")  {return App.Agent.String;}
    if (name == "App_Key_Hash")   {return   App.Key.Hash;}
    if (name == "App_DNA_Hash")   {return   App.DNA.Hash;}
    return "Error: No App Property with name: " + name;
}

// use a local function to resolve which has will be used as "me"
function getMe() {return App.Key.Hash;}

function getDirectory() {return App.DNA.Hash;}

function follow(userAddress) {
  // Expects a userAddress hash of the person you want to follow
    var me = getMe();                  // Looks up my hash address and assign it to 'me'

       // Commits a new follow entry to my source chain
       // On the DHT, puts a link on their hash to my hash as a "follower"
       // On the DHT, puts a link on my hash to their hash as a "following"
    return commit("follow",
                  {Links:[
                      {Base:userAddress,Link:me,Tag:"follower"},
                      {Base:me,Link:userAddress,Tag:"following"}
                  ]});
}

function unfollow(userAddress){
    var me = getMe();                       // Looks up my hash address and assign it to 'me'
    return commit("unfollow",userAddress);  // On my source chain, commits the unfollow entry
    // (delmeta userAddress me "follower")  // Marks the given follower link on their hash as deleted
    // (delmeta me userAddress "following") // Marks the given following link on my hash as deleted
}

function post(postBody) {
    var key = commit("post",postBody);        // Commits the post block to my source chain, assigns resulting hash to 'key'
    var me = getMe();                       // Looks up my hash address and assign it to 'me'
                                            // which DHT nodes will use to request validation info from my source chain

      // On the DHT, puts a link on my hash to the new post
    commit("post_links",{Links:[{Base:me,Link:key,Tag:"post"}]});

    debug("meta: "+JSON.stringify(getLink(me,"post",{Load:true})));
    debug(key);
    return key;                                  // Returns the hash key of the new post to the calling function
}

function isErr(result) {
    return ((typeof result === 'object') && result.name == "HolochainError");
}

// Helper function to do getLink call, handle the no-link error case, and copy the returned entry values into a nicer array
function doGetLinkLoad(base, tag) {
    // get the tag from the base in the DHT
    var links = getLink(base, tag,{Load:true});
    if (isErr(links)) {
        links = [];
    } else {
        links = links.Links;
    }
    var links_filled = [];
    for (var i=0;i <links.length;i++) {
        var link = {H:links[i].H};
        link[tag] = links[i].E;
        links_filled.push(link);
    }
    debug("Links Filled:"+JSON.stringify(links_filled));
    return links_filled;
}

// helper function to call getLinks, handle the no links entry error, and build a simpler links array.
function doGetLink(base,tag) {
    // get the tag from the base in the DHT
    var links = getLink(base, tag,{Load:true});
    if (isErr(links)) {
        links = [];
    }
     else {
        links = links.Links;
    }
    debug("Links:"+JSON.stringify(links));
    var links_filled = [];
    for (var i=0;i <links.length;i++) {
        links_filled.push(links[i].H);
    }
    return links_filled;
}

// TODO add "last 10" or "since timestamp" when query info is supported
function getPostsBy(userAddress) {
  // From the DHT, gets all "post" metadata entries linked from this userAddress
    return JSON.stringify(doGetLinkLoad(userAddress,"post"));
}

// get a list of all the people from the DHT a user is following or follows
function getFollow(params) {
    var type = params.type;
    var  base = params.from;
    var result = {};
    if ((type == "follows") || (type == "following")) {
        result["result"] = doGetLink(base,type);
    }
    else {
        result["error"] = "bad type: "+type;
    }
    return result;
}

function newHandle(handle){
    var me = getMe();
    var directory = getDirectory();
    var handles = doGetLink(me,"handle");
    var n = handles.length - 1;
    if (n >= 0) {
        var oldKey = handles[n];
        var key = update("handle",handle,oldKey);

        debug(handle+" is "+key);
        commit("handle_links",
               {Links:[
                   {Base:me,Link:oldKey,Tag:"handle",LinkAction:HC.LinkAction.Del},
                   {Base:me,Link:key,Tag:"handle"}
               ]});
        commit("handle_links",
               {Links:[
                   {Base:directory,Link:oldKey,Tag:"handle",LinkAction:HC.LinkAction.Del},
                   {Base:directory,Link:key,Tag:"handle"}
               ]});
        return key;
    }
    return addHandle(handle);
}

function addHandle(handle) {
    // TODO confirm no collision
    var key = commit("handle",handle);        // On my source chain, commits a new handle entry
    var me = getMe();
    var directory = getDirectory();

    debug(handle+" is "+key);

    debug("HQ1"+commit("handle_links", {Links:[{Base:me,Link:key,Tag:"handle"}]}));
    debug("HQ2"+commit("handle_links", {Links:[{Base:directory,Link:key,Tag:"handle"}]}));

    return key;
}

// returns the handle of an agent by looking it up on the user's DHT entry, the last handle will be the current one?
function getHandle(userHash) {
    var handles = doGetLinkLoad(userHash,"handle");
    var n = handles.length -1;
    var h = handles[n];
    return (n >= 0) ? h.handle : "";
}

// returns the agent associated agent by converting the handle to a hash
// and getting that hash's source from the DHT
function getAgent(handle) {
    var directory = getDirectory();
    var handleHash = makeHash(handle);
    var sources = get(handleHash,{GetMask:HC.GetMask.Sources});

    if (isErr(sources)) {sources = [];}
    if (sources != undefined) {
        var n = sources.length -1;
        return (n >= 0) ? sources[n] : "";
    }
    return "";
}

// ==============================================================================
// CALLBACKS: Called by back-end system, instead of front-end app or UI
// ===============================================================================

// GENESIS - Called only when your source chain is generated:'hc gen chain <name>'
// ===============================================================================
function genesis() {                            // 'hc gen chain' calls the genesis function in every zome file for the app

    // use the agent string (usually email) used with 'hc init' to identify myself and create a new handle
    addHandle(App.Agent.String);
    //commit("anchor",{type:"sys",value:"directory"});
    return true;
}

// ===============================================================================
//   VALIDATION functions for *EVERY* change made to DHT entry -
//     Every DHT node uses their own copy of these functions to validate
//     any and all changes requested before accepting. put / mod / del & metas
// ===============================================================================
function validate(entry_type,entry,meta) {
    debug("validate: "+entry_type);
    if (entry_type=="post") {
        var l = entry.message.length;
        if (l>0 && l<256) {return true;}
        return false;
    }
    if (entry_type=="handle") {
        return true;
    }
    if (entry_type=="follow") {
        return true;
    }
    return true;
}

function validatePut(entry_type,entry,header,pkg,sources) {
    return validate(entry_type,entry,header,sources);
}
function validateCommit(entry_type,entry,header,pkg,sources) {
    return validate(entry_type,entry,header,sources);
}

// Are there types of tags that you need special permission to do put?
// Examples: Only Bob should be able to make Bob a "follower" of Alice
//   - Only Bob should be able to list Alice in his people he is "following"
//  true)
// need always to check
function validateLink(linkEntryType,baseHash,links,pkg,sources){return true;}
function validateMod(entry_type,hash,newHash,pkg,sources) {return true;}
function validateDel(entry_type,hash,pkg,sources) {return true;}

// ===============================================================================
//   PACKAGING functions for *EVERY* validation call for DHT entry
//     What data needs to be sent for each above validation function?
//     Default: send and sign the chain entry that matches requested HASH
// ===============================================================================

function validatePutPkg(entry_type) {return null;}
function validateModPkg(entry_type) { return null;}
function validateDelPkg(entry_type) { return null;}
function validateLinkPkg(entry_type) { return null;}
