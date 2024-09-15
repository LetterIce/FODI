export const generateCode = (
  loginHost,
  apiHost,
  clientId,
  clientSecret,
  replayURL,
  refreshToken,
  exposePath,
  passwordFilename,
  protectedLayers,
  exposePw
) => {
  return `const EXPOSE_PATH = "${exposePath}";
const ONEDRIVE_REFRESHTOKEN = "${refreshToken}";
const PASSWD_FILENAME = "${passwordFilename}";
const PROTECTED_LAYERS = ${protectedLayers};
const EXPOSE_PASSWD = "${exposePw}";
const clientId = "${clientId}";
const clientSecret = "${clientSecret}";
const loginHost = "${loginHost}";
const apiHost = "${apiHost}";
const redirectUri = "${replayURL}";

addEventListener('scheduled', event => {
  event.waitUntil(fetchAccessToken( /* event.scheduledTime */));
});

addEventListener("fetch", (event) => {
  try {
    return event.respondWith(handleRequest(event.request));
  } catch (e) {
    return event.respondWith(new Response("Error thrown " + e.message));
  }
});

const OAUTH = {
  redirectUri: redirectUri,
  refreshToken: ONEDRIVE_REFRESHTOKEN,
  clientId: clientId,
  clientSecret: clientSecret,
  oauthUrl: loginHost + "/common/oauth2/v2.0/",
  apiUrl: apiHost + "/v1.0/me/drive/root",
  scope: apiHost + "/Files.ReadWrite.All offline_access",
};

const PATH_AUTH_STATES = Object.freeze({
  NO_PW_FILE: Symbol("NO_PW_FILE"),
  PW_CORRECT: Symbol("PW_CORRECT"),
  PW_ERROR: Symbol("PW_ERROR")
});

async function handleRequest(request) {
  let queryString, querySplited, requestPath;
  let abnormalWay = false;
  const returnHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "max-age=3600",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (request.url.includes("?")) {
    queryString = decodeURIComponent(request.url.split("?")[1]);
  } else if (request.url.split("/").pop().includes(".")) {
    queryString = decodeURIComponent("file=/" + request.url.split("://")[1].split(/\u005c/(.+)/)[1]);
    abnormalWay = true;
  }
  if (queryString) querySplited = queryString.split("=");
  if ((querySplited && querySplited[0] === "file") || abnormalWay) {
    const file = querySplited[1];
    const fileName = file.split("/").pop();
    if (fileName === PASSWD_FILENAME)
      return Response.redirect(
        "https://www.baidu.com/s?wd=%E6%80%8E%E6%A0%B7%E7%9B%97%E5%8F%96%E5%AF%86%E7%A0%81",
        301
      );
    requestPath = file.replace("/" + fileName, "");
    const url = await fetchFiles(requestPath, fileName);
    return Response.redirect(url, 302);
  } else if (querySplited && querySplited[0] === "upload") {
    requestPath = querySplited[1];
    const uploadAllow = await fetchFiles(requestPath, ".upload");
    const fileList = await request.json();
    const pwAttack = fileList["files"].some(file => file.remotePath.split("/").pop() === PASSWD_FILENAME);
    if (uploadAllow && !pwAttack) {
      const uploadLinks = await uploadFiles(fileList);
      return new Response(uploadLinks, {
        headers: returnHeaders,
      });
    }
    return new Response(
      JSON.stringify({ error: "Access forbidden" }),
      {
        status: 403,
        headers: returnHeaders
      }
    );
  } else {
    const { headers } = request;
    const contentType = headers.get("content-type");
    const body = {};
    if (contentType && contentType.includes("form")) {
      const formData = await request.formData();
      for (const entry of formData.entries()) {
        body[entry[0]] = entry[1];
      }
    }
    requestPath = Object.getOwnPropertyNames(body).length ? body["?path"] : "";
    const files = await fetchFiles(requestPath, null, body.passwd);
    return new Response(files, {
      headers: returnHeaders,
    });
  }
}

async function gatherResponse(response) {
  const {
    headers
  } = response;
  const contentType = headers.get("content-type");
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  return await response.text();
}

async function cacheFetch(url, options) {
  return fetch(new Request(url, options), {
    cf: {
      cacheTtl: 3600,
      cacheEverything: true,
    },
  });
}

async function getContent(url) {
  const response = await cacheFetch(url);
  const result = await gatherResponse(response);
  return result;
}

async function getContentWithHeaders(url, headers) {
  const response = await cacheFetch(url, {
    headers: headers
  });
  const result = await gatherResponse(response);
  return result;
}

async function fetchFormData(url, data) {
  const formdata = new FormData();
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      formdata.append(key, data[key]);
    }
  }
  const requestOptions = {
    method: "POST",
    body: formdata,
  };
  const response = await cacheFetch(url, requestOptions);
  const result = await gatherResponse(response);
  return result;
}

async function fetchAccessToken() {
  let refreshToken = OAUTH["refreshToken"];
  if (typeof FODI_CACHE !== 'undefined') {
    const cache = JSON.parse(await FODI_CACHE.get('token_data'));
    if (cache?.refresh_token) {
      const passedMilis = Date.now() - cache.save_time;
      if (passedMilis / 1000 < cache.expires_in - 600) {
        return cache.access_token;
      }

      if (passedMilis < 6912000000) {
        refreshToken = cache.refresh_token;
      }
    }
  }

  const url = OAUTH["oauthUrl"] + "token";
  const data = {
    client_id: OAUTH["clientId"],
    client_secret: OAUTH["clientSecret"],
    grant_type: "refresh_token",
    requested_token_use: "on_behalf_of",
    refresh_token: refreshToken,
  };
  const result = await fetchFormData(url, data);

  if (typeof FODI_CACHE !== 'undefined' && result?.refresh_token) {
    result.save_time = Date.now();
    await FODI_CACHE.put('token_data', JSON.stringify(result));
  }
  return result.access_token;
}

async function fetchFiles(path, fileName, passwd, viewExposePathPassword) {
  const relativePath = path;
  if (path === "/") path = "";
  if (path || EXPOSE_PATH) path = ":" + EXPOSE_PATH + path;

  const accessToken = await fetchAccessToken();
  const expand = path
    ? ":/children?select=name,size,parentReference,lastModifiedDateTime,@microsoft.graph.downloadUrl&$top=200"
    : "?expand=children(select=name,size,parentReference,lastModifiedDateTime,@microsoft.graph.downloadUrl)";
  const uri = OAUTH.apiUrl + encodeURI(path) + expand;
  let pageRes = await getContentWithHeaders(uri, {
    Authorization: "Bearer " + accessToken,
  });
  let body = { children: pageRes.value ? pageRes.value : pageRes.children };
  while (pageRes["@odata.nextLink"]) {
    pageRes = await getContentWithHeaders(pageRes["@odata.nextLink"], {
      Authorization: "Bearer " + accessToken,
    });
    body.children = body.children.concat(pageRes.value);
  }

  const pwFile = body.children.filter(file => file.name === PASSWD_FILENAME)[0];
  const PASSWD = pwFile ? await getContent(pwFile["@microsoft.graph.downloadUrl"]) : '';
  if (viewExposePathPassword) {
    return PASSWD;
  }

  let authState = PATH_AUTH_STATES.NO_PW_FILE;
  if (pwFile) {
    if (PASSWD === passwd) {
      authState = PATH_AUTH_STATES.PW_CORRECT;
    } else {
      authState = PATH_AUTH_STATES.PW_ERROR;
    }
  }

  let parent = body.children.length ?
    body.children[0].parentReference.path :
    body.parentReference.path;
  parent = parent.split(":").pop().replace(EXPOSE_PATH, "") || "/";
  parent = decodeURIComponent(parent);

  if (authState === PATH_AUTH_STATES.NO_PW_FILE && parent.split("/").length <= PROTECTED_LAYERS) {
    const upperPasswd = EXPOSE_PASSWD ? EXPOSE_PASSWD : (
      (!relativePath || relativePath === "/") ? "" : await fetchFiles("", null, null, true)
    );
    if (upperPasswd !== passwd) {
      authState = PATH_AUTH_STATES.PW_ERROR;
    }
  }

  // Auth failed
  if (authState === PATH_AUTH_STATES.PW_ERROR) {
    return JSON.stringify({
      parent,
      files: [],
      encrypted: true
    });
  }

  // Download file
  if (fileName) {
    return body
      .children
      .filter(file => file.name === decodeURIComponent(fileName))[0]?.["@microsoft.graph.downloadUrl"];
  }

  // List folder
  return JSON.stringify({
    parent,
    files: body.children.map(file => ({
      name: file.name,
      size: file.size,
      time: file.lastModifiedDateTime,
      url: file["@microsoft.graph.downloadUrl"],
    })).filter(file => file.name !== PASSWD_FILENAME)
  });
}

async function uploadFiles(fileJsonList) {
  let fileList = fileJsonList["files"];
  const accessToken = await fetchAccessToken();
  await Promise.all(
    fileList.map(async (file) => {
      const uri = \`\${OAUTH.apiUrl}:\${EXPOSE_PATH}\${file["remotePath"]}:/createUploadSession\`;
      const headers = {
        Authorization: "Bearer " + accessToken,
      };
      const uploadUrl = await fetch(uri, {
        method: "POST",
        headers: headers,
      })
        .then((response) => {
          return response.json();
        })
        .then((data) => {
          return data["uploadUrl"];
        });
      file.uploadUrl = uploadUrl;
    })
  );
  return JSON.stringify({ files: fileList });
}`;
};
