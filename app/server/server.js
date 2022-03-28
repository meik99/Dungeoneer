const util = require("./js/util");
const ElementCreator = require("./js/lib/elementCreator");
const dataAccess = require("./js/dataaccess");
const { ipcRenderer } = require('electron');
const pathModule = require('path');
const clientPath = "file:///C:/Forritun/Dungeoneer/docs/client.html"//"https://www.ogreforge.me/Dungeoneer"
const pendingStateRequests = [];


ipcRenderer.on("maptool-server-event", function (event, message) {
    console.log(event);
    console.log(message);
    if (message.event == 'maptool-state') {
        sendMaptoolState(message.data);
    }

    // notifyServer("foreground", { path: path , width});

    // notifyServer("background", { path: path , width});
    // notifyServer("overlay", { path: path , width});
    // window.setTimeout(() => notifyServer("foreground-size", { width: newWidth }), 1000);
    // window.setTimeout(() => notifyServer("background-size", { width: newWidth }), 1000);
    // window.setTimeout(() => notifyServer("overlay-size", { width: newWidth }), 1000);
    // notifyServer("segments", {segments: newSegments});
});

var connectionObj =
{
    secure: true,
    host: 'dungeoneer-peer-server.herokuapp.com',
    port: 443
}

var peers = [];
peers.add = function (element) {
    this.push(element);
    this.onchange();
}

peers.remove = function (element) {
    const index = this.indexOf(element);
    if (index > -1) {
        this.splice(index, 1);
    }
    this.onchange();
}

peers.onchange = function () {
    console.log("Peers changed");
    var cont = document.getElementById("peers_container");
    while (cont.firstChild)
        cont.removeChild(cont.firstChild);

    peers.forEach(peer => cont.appendChild(createPeerElement(peer)));
}

function createPeerElement(peer) {
    var ele = util.ele("div", "peer_node column peer_connected");
    var p = util.ele("p", "peer_name", peer.name || "???");
    ele.appendChild(p);
    ele.appendChild(ElementCreator.checkBox("Pawn!", (e) => {
        peer.connection.send("You control nothing");
    }));
    return ele;
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("init_server_button").onclick = () => initServer();
    document.getElementById("server_id").onclick = (e) => {
        navigator.clipboard.writeText(e.target.value).then(function () {
            util.showMessage("Host ID copied to clipboard");
        }, function (err) {
            console.error('Async: Could not copy text: ', err);
        });
    };

    document.getElementById("invite_link_button").onclick = (e) => {
        var text = `${clientPath}?hostID=${document.getElementById("server_id").value}`
        navigator.clipboard.writeText(text).then(function () {
            util.showMessage("Invite link copied to clipboard");
        }, function (err) {
            console.error('Async: Could not copy text: ', err);
        });
    };

});

function initServer() {
    showLoading("Contacting P2P server");
    var peer = new Peer(connectionObj);
    peer.on('open', function (id) {

        document.getElementById("server_id").value = id;
        document.getElementById("server_info_container").classList.remove("hidden");
        document.getElementById("init_server_button").classList.add("hidden");
        document.getElementById("status_text").innerHTML = "Server running";
        hideLoading();
    });

    peer.on('disconnected', function () {
        console.log("Peer disconnected")
        peer.reconnect();
        clearError();
    });
    peer.on('error', function (err) {
        hideLoading();
        showError(err);

        document.getElementById("init_server_button").innerHTML = "Retry";
    });

    peer.on('connection', function (conn) {
        onConnected(conn);

    });
}

function onConnected(conn) {
    console.log("Peer connected");
    console.log(conn);

    var peer = peers.find(x => x.connectonId == conn.connectionId);
    if (!peer) {
        peers.add({ connection: conn, connectionId: conn.connectionId });
    }
    conn.on('data', function (data) {
        console.log('Received', data);
        handleDataEvent(data, conn);
        conn.send("ack");
    });
    conn.on('error', function (err) {
        showError(`Error in peer connection ${err}`);
        var disonnected = peers.filter(x => !x.connection.open);
        disonnected.forEach(peer => peers.remove(peer));
    });

    conn.on('close', () => {
        peers.onchange();
        console.log("Connection closed");
        var disonnected = peers.filter(x => !x.connection.open);
        disonnected.forEach(peer => peers.remove(peer));
    });
}

function handleDataEvent(data, connection) {
    console.log(`Data from ${connection}`)
    console.log(data);
    if (data.messageType == "init") {

        var peer = peers.find(x => x.connectionId == connection.connectionId);
        if (!peer)
            throw "peer not found";
        peer.name = data.name;
        peers.onchange();
        pendingStateRequests.push(peer);
        ipcRenderer.send('request-maptool-state');

    }
}



function sendMaptoolState(maptoolState) {

    dataAccess.getSettings(async (settings) => {
        while (pendingStateRequests.length > 0) {
            var peer = pendingStateRequests.pop();

            var mt = settings.maptool;


            var dataObject = {
                foreground: mt.currentMap ? await util.toBase64(mt.currentMap) : null,
                background: mt.currentBackground ? await util.toBase64(mt.currentBackground) : null,
                mapEdge: mt.map_edge_style ? await util.toBase64(mt.map_edge_style) : null,
                overlay: mt.currentOverlay ? await util.toBase64(mt.currentOverlay) : null,
            };
            peer.connection.send({ messageType: "constants", data: constants })

            sendBatched(peer.connection, "foreground", dataObject.foreground, { width: mt.gridSettings.mapSize });
            sendBatched(peer.connection, "map_edge", dataObject.mapEdge)
            sendBatched(peer.connection, "background", dataObject.background, { width: mt.gridSettings.mapBackgroundSize });
            sendBatched(peer.connection, "overlay", dataObject.overlay, { width: mt.gridSettings.mapOverlaySize });
            var distinctTokenImages = [... new Set(maptoolState.tokens.map(x => x.bgPhoto))];
            console.log(maptoolState.tokens.map(x => x.bgPhoto))
            for (var i = 0; i < distinctTokenImages.length; i++) {
                var path = distinctTokenImages[i];
                console.log(path)
                var filtered = maptoolState.tokens.filter(x => x.bgPhoto == path);
                var base64 = await util.toBase64(path);

                filtered.forEach(x => {
                    var basename = pathModule.basename(x.bgPhoto);
                    x.bgPhotoBase64 = base64;
                    x.bgPhoto = null;
                    x.tokenName = basename;
                });
            }
            var tokenJSON = JSON.stringify(maptoolState.tokens);
            console.log(maptoolState.tokens)
            sendBatched(peer.connection, "tokens", tokenJSON);

            // tokens: tokens,
            // backgroundLoop: bgState,
            // overlayLoop: overlayState,
            // effects: getEffectsForExport()
        }
    });
}

const CHUNK_SIZE = 1000000;
function sendBatched(connection, key, msgString, metadata) {
    if (msgString == null) {
        return connection.send({ messageType: key, data: { base64: null, chunk: 1, chunks: 1 } });
    }
    var totalLength = msgString.length;
    var chunks = Math.ceil(totalLength / CHUNK_SIZE);

    for (var i = 0; i < chunks; i++) {
        var start = i * CHUNK_SIZE;
        connection.send({ messageType: key, data: { base64: msgString.substring(start, start + CHUNK_SIZE), chunk: i + 1, chunks: chunks, metadata: metadata } });
    }

}

function showError(err) {
    document.getElementById("error_message").innerHTML = err;
}

function clearError() {
    document.getElementById("error_message").innerHTML = "";
}

function hideLoading() {
    document.getElementById("loading").classList.add("hidden");;
}
function showLoading(text) {
    var loadingEle = document.getElementById("loading");
    document.getElementById("loading_text").innerHTML = text;
    loadingEle.classList.remove("hidden");
}


