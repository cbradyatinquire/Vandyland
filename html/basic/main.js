let uploadInterval = undefined;
let lastUploadTime = 0;
let syncRate       = 5000;
let knownNames     = new Set();

let setSessionName = function(name) {
  window.location.hash = name;
  document.getElementById('session-name').innerText = name;
};

let getSessionName = function() {
  return document.getElementById('session-name').innerText;
};

let getStudentToken = function() {
  return window.localStorage.getItem("student-token");
}

let getToken = function() {
  return window.localStorage.getItem("mod-token") || getStudentToken();
}

window.onEnter = function(f) { return function(e) { if (e.keyCode === 13) { return f(e); } }; };

window.startSession = function(sessionName) {

  document.getElementById("landing-area").classList.add   ("hidden");
  document.getElementById("main-content").classList.remove("hidden");

  let startup = function(sessionName) {
    setSessionName(sessionName);
    let token = getToken()
    if (token !== null) {
      uploadInterval = setInterval(sync, syncRate);
    } else {
      fetch(window.thisDomain + "/uploader-token", { method: "GET" }).then((x) => x.text()).then(
        function (t) {
          window.localStorage.setItem("student-token", t);
          uploadInterval = setInterval(sync, syncRate);
        }
      );
    }
  };

  if (sessionName === undefined) {
    fetch(window.thisDomain + "/new-session", { method: "POST" }).then((x) => x.text()).then(startup);
  } else {
    startup(sessionName);
    sync()
  }

};

let sync = function() {

  let gallery = document.getElementById('gallery');

  let callback = function(entries) {

    let containerPromises =
      entries.map(function(entry) {

        let img = document.createElement("img");
        img.classList.add("upload-image");
        img.src = entry.base64Image;
        img.onclick = function() {
          let dataPromise     = fetch(window.thisDomain + "/uploads/"  + getSessionName() + "/" + entry.uploadName).then(x => x.text());
          let commentsPromise = fetch(window.thisDomain + "/comments/" + getSessionName() + "/" + entry.uploadName).then(x => x.json());
          let commentURL      = window.thisDomain + "/comments"
          Promise.all([dataPromise, commentsPromise]).then(([data, comments]) => showModal(getSessionName(), entry.uploadName, entry.metadata, data, comments, entry.base64Image, commentURL));
        };

        let label       = document.createElement("span");
        let boldStr     = function(str) { return '<span style="font-weight: bold;">' + str + '</span>' };
        label.innerHTML = entry.metadata === null ? boldStr(entry.uploadName) : boldStr(entry.uploadName) + " by " + boldStr(entry.metadata);
        label.classList.add("upload-label")

        let container = document.createElement("div")
        container.appendChild(img);
        container.appendChild(label);
        container.classList.add("upload-container");
        container.dataset.uploadName = entry.uploadName;

        if (entry.isOwner || entry.canModerate) {
          let template = document.getElementById("deleter-template");
          let deleter  = document.importNode(template.content, true).querySelector(".deleter");
          deleter.onclick = function() {
            if (window.confirm("Are you sure you want to delete this submission?  No one will be able to see it if you click \"OK\".")) {
              container.remove();
              let token = getToken() || "";
              fetch(window.thisDomain + `/uploads/${getSessionName()}/${entry.uploadName}/${token}`, { method: "DELETE" });
            }
          };
          container.appendChild(deleter);
        }

        return container;

      });

    Promise.all(containerPromises).then((containers) => containers.forEach((container) => gallery.appendChild(container)));

  };

  fetch(window.thisDomain + "/listings/" + getSessionName()).then(x => x.json()).then(
    function(listings) {

      let newNames = listings.filter((l) => !knownNames.has(l.subName) && !l.isSuppressed).map((l) => l.subName);
      newNames.forEach((name) => knownNames.add(name));

      let supNames = listings.filter((l) => l.isSuppressed).map((l) => l.subName);
      supNames.forEach((name) => {
        knownNames.delete(name)
        let elem = document.querySelector(`.upload-container[data-uploadName="${name}"]`);
        if (elem !== null) {
          elem.remove();
        }
      });

      let token  = getToken() || "";
      let params = makeQueryString({ "session-id": getSessionName(), "names": JSON.stringify(newNames) });

      return fetch(window.thisDomain + `/data-lite/${token}`, { method: "POST", body: params, headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    }
  ).then(x => x.json()).then(callback);

};

window.upload = function(e) {

  e.preventDefault();

  if ((new Date().getTime() - lastUploadTime) > syncRate) {

    new Promise(
      function(resolve, reject) {
        let reader = new FileReader();
        reader.onloadend = function(event) {
          resolve(event.target);
        };
        reader.readAsDataURL(document.getElementById('upload-image').files[0]);
      }
    ).then(function(imageEvent) {
      if (imageEvent.result) {

        let formData = new FormData(document.getElementById("upload-form"));
        formData.set("image"     , imageEvent.result);
        formData.set("session-id", getSessionName());
        formData.set("token",      getStudentToken() || "");
        return fetch(window.thisDomain + "/file-uploads/", { method: "POST", body: formData });

      } else {
        reject("Image conversion failed somehow...?  Error: " + JSON.stringify(imageEvent.error));
      }
    }).then(function(response) {
      if (response.status === 200) {
        clearInterval(uploadInterval);
        sync();
        uploadInterval = setInterval(sync, syncRate);
      } else {
        response.text().then(function(body) { alert(JSON.stringify(body)) });
      }
    });

    lastUploadTime = new Date().getTime();

    let elem = document.getElementById('upload-submit-button');
    elem.disabled = true;
    setTimeout(function() { elem.disabled = false; }, syncRate);

  }

  return false;

};
