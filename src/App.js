import React, { useRef, useEffect, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import provinces from "./skorea-provinces-geo.json";
import municipalities from "./skorea-municipalities-geo.json";

mapboxgl.accessToken =
  "pk.eyJ1Ijoiam9uZ2tleTk0IiwiYSI6ImNtZ3czM2o5NjBoaTgycXNpNWtmeTFtd3cifQ.nHtLFX7O-gtrMKnXzgcrmw";

// 개인별 전역 쿨타임 3분
const COOLDOWN_MS = 3 * 60 * 1000;

// 고유 ID
const uniqueId = (() => {
  let n = 0;
  return (prefix = "id") =>
    `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;
})();

// ===================== 이름/코드 전처리 유틸 =====================
const HANGUL_RE = /[가-힣]/g;
const BAD_LANGUAGE_TAG_RE = /^(ko|kor|kr|korean)$/i;
const PROV_SUFFIX_KO = /(특별시|광역시|자치시|특별자치시|특별자치도|자치도|도)$/;
const MUN_SUFFIX_KO = /(시|군|구)$/;
const ROMA_SUFFIX_RE = /(?:-?\s*(do|si|gun|gu))$/i;

const pickFirst = (obj, keys) => {
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] != null &&
      obj[k] !== ""
    ) {
      return String(obj[k]).trim();
    }
  }
  return null;
};
const pickAll = (obj, keys) => {
  const out = [];
  for (const k of keys) {
    if (
      obj &&
      Object.prototype.hasOwnProperty.call(obj, k) &&
      obj[k] != null &&
      obj[k] !== ""
    ) {
      out.push(String(obj[k]).trim());
    }
  }
  return out;
};
const splitTokens = (val) =>
  typeof val !== "string"
    ? []
    : val
        .replace(/[()]/g, " ")
        // eslint 경고 제거: \| \/ 대신 그대로 사용
        .split(/[|/,]+/g)
        .flatMap((t) => t.split(/\s{2,}/g))
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => (t.length > 80 ? t.slice(0, 80) : t));
const hangulCount = (s) =>
  typeof s === "string" && s.match(HANGUL_RE) ? s.match(HANGUL_RE).length : 0;
const scoreName = (s, level) => {
  if (!s) return -1;
  if (BAD_LANGUAGE_TAG_RE.test(s)) return -999;
  if (/^[A-Za-z]{1,3}$/.test(s)) return -999;
  let score = 0;
  score += hangulCount(s) * 10;
  if (level === "mun") {
    if (MUN_SUFFIX_KO.test(s)) score += 30;
    if (PROV_SUFFIX_KO.test(s)) score -= 40;
  } else {
    if (PROV_SUFFIX_KO.test(s)) score += 20;
    if (MUN_SUFFIX_KO.test(s)) score -= 10;
  }
  if (ROMA_SUFFIX_RE.test(s)) score += 6;
  if (s.length < 2) score -= 10;
  // eslint 경고 제거: 대괄호 안 마지막에 - 배치
  if (/^[\s0-9-]+$/.test(s)) score -= 10;
  return score;
};

const STRICT_MUN_NAME_KEYS = [
  "SIG_KOR_NM",
  "SIG_ENG_NM",
  "SIG_NM",
  "SIG_ENG",
  "ADM2_KOR_NM",
  "ADM2_ENG_NM",
  "si_gun_gu",
  "SI_GUN_GU",
  "SIGUNGU",
  "SIGUNGU_NM",
  "NAME_2",
  "NAME_ENG2",
  "NAME_KO2",
  "NAME_MUN",
  "MUN_NAME",
];
const PROV_NAME_KEYS = [
  "CTP_KOR_NM",
  "CTP_ENG_NM",
  "CTP_KOR",
  "CTP_ENG",
  "SIDO_NM",
  "sido",
  "ADM1_KOR_NM",
  "ADM1_ENG_NM",
  "ADM_NM",
  "NAME_KO",
  "NAME_KOR",
  "NAME_LOCAL",
  "KOR_NM",
  "korName",
  "name_ko",
  "ko_name",
  "label_ko",
  "local",
  "localName",
  "local_name",
  "label",
  "name",
  "NAME",
  "full_nm",
  "adm_nm",
];
const MUN_NAME_KEYS = [
  ...STRICT_MUN_NAME_KEYS,
  "ADM_NM",
  "NAME_KO",
  "NAME_KOR",
  "NAME_LOCAL",
  "KOR_NM",
  "korName",
  "name_ko",
  "ko_name",
  "label_ko",
  "local",
  "localName",
  "local_name",
  "label",
  "name",
  "NAME",
  "full_nm",
  "adm_nm",
];
const PROV_CODE_KEYS = [
  "CTPRVN_CD",
  "sido_cd",
  "ADM1_CD",
  "ADM_CD",
  "code",
  "CODE",
  "ID",
  "id",
];
const MUN_CODE_KEYS = [
  "SIG_CD",
  "sig_cd",
  "ADM2_CD",
  "ADM_CD",
  "code",
  "CODE",
  "ID",
  "id",
];

const resolveNameFromProps = (props, level) => {
  if (!props) return null;
  if (level === "mun") {
    const strict = pickFirst(props, STRICT_MUN_NAME_KEYS);
    if (strict) return strict;
    const direct = pickAll(props, MUN_NAME_KEYS);
    let tokens = [];
    for (const v of direct) tokens.push(v, ...splitTokens(v));
    const provVals = pickAll(props, PROV_NAME_KEYS);
    const provSet = new Set(
      provVals
        .flatMap((v) => [v, ...splitTokens(v)])
        .map((t) => t.trim())
        .filter(Boolean)
    );
    tokens = tokens.filter((t) => t && !provSet.has(t));
    if (!tokens.length) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (typeof v === "string" && v.trim())
          tokens.push(v.trim(), ...splitTokens(v));
      }
      tokens = tokens.filter((t) => t && !provSet.has(t));
    }
    if (!tokens.length) return null;
    tokens = tokens
      .filter((t) => !BAD_LANGUAGE_TAG_RE.test(t))
      .filter((t) => !/^[A-Za-z]{1,3}$/.test(t));
    tokens.sort((a, b) => scoreName(b, "mun") - scoreName(a, "mun"));
    return tokens[0].replace(/\s*-\s*/g, "-").trim();
  }
  const strictProv = pickFirst(props, PROV_NAME_KEYS);
  if (strictProv) return strictProv;
  let tokens = [];
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (typeof v === "string" && v.trim())
      tokens.push(v.trim(), ...splitTokens(v));
  }
  tokens = tokens
    .filter(Boolean)
    .filter((t) => !BAD_LANGUAGE_TAG_RE.test(t))
    .filter((t) => !/^[A-Za-z]{1,3}$/.test(t));
  if (!tokens.length) return null;
  tokens.sort((a, b) => scoreName(b, "prov") - scoreName(a, "prov"));
  return tokens[0].replace(/\s*-\s*/g, "-").trim();
};
const resolveCodeFromProps = (props, level, i) => {
  const keys = level === "prov" ? PROV_CODE_KEYS : MUN_CODE_KEYS;
  const raw = pickFirst(props, keys);
  return raw != null ? String(raw) : `idx_${i}`;
};

// ✅ feature-state용 id 강제 부여
const preprocessGeojson = (geojson, level) => {
  if (!geojson || !geojson.features) return geojson;
  const features = geojson.features.map((f, i) => {
    const props = { ...(f.properties || {}) };
    const name = resolveNameFromProps(props, level) || `이름미상_${i + 1}`;
    const code = resolveCodeFromProps(props, level, i);
    return {
      ...f,
      id: f.id ?? i,
      properties: { ...props, __NAME: name, __CODE: code },
    };
  });
  return { ...geojson, features };
};

// ===== 유틸 =====
const getOrCreateUserId = () => {
  let id = localStorage.getItem("kplace_user_id_v1");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("kplace_user_id_v1", id);
  }
  return id;
};
const formatCount = (n) => {
  if (n == null) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  const units = [
    { v: 1e9, s: "B" },
    { v: 1e6, s: "M" },
    { v: 1e3, s: "k" },
  ];
  for (const u of units)
    if (abs >= u.v)
      return (n / u.v).toFixed(1).replace(/\.0$/, "") + u.s;
  return String(n);
};

// ✅ 고해상도 캔버스에 렌더링하는 헬퍼 (프리뷰 파라미터 그대로 사용)
const renderHighResCanvas = (
  canvas,
  previewCanvas,
  previewGeom,
  img,
  previewParams
) => {
  if (!canvas || !previewCanvas || !previewGeom || !img) return;

  const { mercRings, minX, minY, maxX, maxY } = previewGeom;
  const bboxW = Math.max(1e-12, maxX - minX);
  const bboxH = Math.max(1e-12, maxY - minY);

  // 프리뷰 캔버스 기준
  const baseW = previewCanvas.__cssW || 360;
  const baseH =
    previewCanvas.__cssH ||
    Math.max(1, Math.round((bboxH / bboxW) * baseW));

  // 고해상도 캔버스 크기 (3배)
  const widthCss = baseW * 3;
  const heightCss = baseH * 3;

  canvas.width = widthCss;
  canvas.height = heightCss;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, widthCss, heightCss);

  const toCanvas = ([mx, my]) => [
    ((mx - minX) / bboxW) * widthCss,
    ((my - minY) / bboxH) * heightCss,
  ];

  ctx.save();

  // 클리핑 경계
  ctx.beginPath();
  mercRings.forEach((ring) => {
    const [sx, sy] = toCanvas(ring[0]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toCanvas(ring[i]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  });
  ctx.clip("evenodd");

  const { scale, rotateDeg, offsetX, offsetY } = previewParams;

  // 프리뷰 ↔ 고해상도 해상도 비율
  const factorX = widthCss / baseW;
  const factorY = heightCss / baseH;

  ctx.translate(
    widthCss / 2 + offsetX * factorX,
    heightCss / 2 + offsetY * factorY
  );
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;

  const iw = img.width;
  const ih = img.height;
  const coverS = Math.max(widthCss / iw, heightCss / ih);
  const effScale = Math.max(0.001, scale) * coverS;

  ctx.scale(effScale, effScale);
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

  ctx.restore();
};

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  const [selectedKey, setSelectedKey] = useState(null); // "prov:<CODE>" | "mun:<CODE>"
  const [selectedName, setSelectedName] = useState(null);
  const [selectedLevel, setSelectedLevel] = useState(null); // "prov" | "mun"

  const [searchInput, setSearchInput] = useState("");
  const [uploadedImage, setUploadedImage] = useState(null);

  const selectedSourceRef = useRef(null);
  const selectedIdRef = useRef(null);
  const selectedGeomRef = useRef(null);
  const markerRef = useRef(null);
  const regionCanvasesRef = useRef({});
  const syncLayersRef = useRef(() => {});
  const codeToNameRef = useRef({});

  // ✅ 모바일 여부 체크 (width <= 768px)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      if (typeof window !== "undefined") {
        setIsMobile(window.innerWidth <= 768);
      }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // 누적 좋아요
  const [likes, setLikes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("kplace_likes_v10") || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem("kplace_likes_v10", JSON.stringify(likes));
  }, [likes]);

  // 개인 전역 쿨타임
  const [userId] = useState(() => getOrCreateUserId());
  const [userLastLikeTs, setUserLastLikeTs] = useState(() => {
    const all = JSON.parse(
      localStorage.getItem("kplace_user_lastlike_v1") || "{}"
    );
    return all[userId] || 0;
  });
  useEffect(() => {
    const all = JSON.parse(
      localStorage.getItem("kplace_user_lastlike_v1") || "{}"
    );
    if (all[userId] !== userLastLikeTs) {
      all[userId] = userLastLikeTs;
      localStorage.setItem(
        "kplace_user_lastlike_v1",
        JSON.stringify(all)
      );
    }
  }, [userId, userLastLikeTs]);

  const canLikeNowGlobal = () =>
    Date.now() - (userLastLikeTs || 0) >= COOLDOWN_MS;
  const remainSecondsGlobal = () =>
    Math.ceil(
      Math.max(0, COOLDOWN_MS - (Date.now() - (userLastLikeTs || 0))) /
        1000
    );

  // 이름 캐시
  const [nameCache, setNameCache] = useState({});
  const keyToName = (key) => nameCache[key] || key;

  // Top5
  const topProv = React.useMemo(
    () =>
      Object.entries(likes)
        .filter(([k]) => k.startsWith("prov:"))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [likes]
  );
  const topMun = React.useMemo(
    () =>
      Object.entries(likes)
        .filter(([k]) => k.startsWith("mun:"))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [likes]
  );

  useEffect(() => {
    if (mapRef.current) return;

    const provincesData = preprocessGeojson(provinces, "prov");
    const municipalitiesData = preprocessGeojson(municipalities, "mun");

    // 초기 이름 맵
    const initMap = {};
    provincesData.features.forEach(
      (f) => (initMap["prov:" + f.properties.__CODE] = f.properties.__NAME)
    );
    municipalitiesData.features.forEach(
      (f) => (initMap["mun:" + f.properties.__CODE] = f.properties.__NAME)
    );
    codeToNameRef.current = initMap;
    setNameCache(initMap);

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [127.7669, 36.3],
      zoom: 5.5,
      minZoom: 3.3,
      maxZoom: 12,
      maxBounds: [
        [120.0, 30.0],
        [136.0, 44.0],
      ],
    });
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("provinces", {
        type: "geojson",
        data: provincesData,
      });
      map.addSource("municipalities", {
        type: "geojson",
        data: municipalitiesData,
      });

      // 시/도
      map.addLayer({
        id: "provinces-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#0077B6",
            "#FFFFFF",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.4,
            0.05,
          ],
        },
      });
      map.addLayer({
        id: "provinces-outline",
        type: "line",
        source: "provinces",
        paint: { "line-color": "#003366", "line-width": 2.5 },
      });

      // 시/군/구
      map.addLayer({
        id: "municipalities-fill",
        type: "fill",
        source: "municipalities",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#E85D04",
            "#FFFFFF",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.4,
            0.05,
          ],
        },
      });
      map.addLayer({
        id: "municipalities-outline",
        type: "line",
        source: "municipalities",
        layout: { visibility: "none" },
        paint: { "line-color": "#550000", "line-width": 1.8 },
      });

      // 레이어 토글
      const syncLayers = () => {
        const z = map.getZoom();
        const showProvince = z < 8;

        try {
          if (map.getLayer("provinces-fill"))
            map.setLayoutProperty(
              "provinces-fill",
              "visibility",
              showProvince ? "visible" : "none"
            );
          if (map.getLayer("provinces-outline"))
            map.setLayoutProperty(
              "provinces-outline",
              "visibility",
              showProvince ? "visible" : "none"
            );
          if (map.getLayer("municipalities-fill"))
            map.setLayoutProperty(
              "municipalities-fill",
              "visibility",
              showProvince ? "none" : "visible"
            );
          if (map.getLayer("municipalities-outline"))
            map.setLayoutProperty(
              "municipalities-outline",
              "visibility",
              showProvince ? "none" : "visible"
            );
        } catch (error) {
          console.warn("레이어 visibility 변경 중 오류:", error);
        }

        const layerIds = (map.getStyle()?.layers || []).map((l) => l.id);
        for (const id of layerIds) {
          const isProvinceImg =
            id.startsWith("province-") && id.endsWith("-layer");
          const isMunicipalImg =
            id.startsWith("municipality-") && id.endsWith("-layer");
          if (!isProvinceImg && !isMunicipalImg) continue;
          if (!map.getLayer(id)) continue;
          const shouldShow =
            (showProvince && isProvinceImg) ||
            (!showProvince && isMunicipalImg);
          try {
            map.setLayoutProperty(
              id,
              "visibility",
              shouldShow ? "visible" : "none"
            );
          } catch (error) {
            console.warn("이미지 레이어 visibility 변경 중 오류:", error);
          }
        }
      };

      syncLayersRef.current = syncLayers;
      map.on("zoom", syncLayers);
      syncLayers();

      // 클릭 선택
      map.on("click", (e) => {
        // ✅ 주소 검색 마커는 지도 아무 곳이나 클릭하면 제거
        if (markerRef.current) {
          markerRef.current.remove();
          markerRef.current = null;
        }

        const useProvince = map.getZoom() < 8;
        const layerId = useProvince
          ? "provinces-fill"
          : "municipalities-fill";
        const features = map.queryRenderedFeatures(e.point, {
          layers: [layerId],
        });

        if (!features.length) {
          if (
            selectedSourceRef.current &&
            selectedIdRef.current != null
          ) {
            map.setFeatureState(
              {
                source: selectedSourceRef.current,
                id: selectedIdRef.current,
              },
              { selected: false }
            );
          }
          selectedSourceRef.current = null;
          selectedIdRef.current = null;
          selectedGeomRef.current = null;
          setSelectedKey(null);
          setSelectedName(null);
          setSelectedLevel(null);
          return;
        }

        const f = features[0];
        const source = useProvince ? "provinces" : "municipalities";

        if (
          selectedSourceRef.current &&
          selectedIdRef.current != null
        ) {
          map.setFeatureState(
            {
              source: selectedSourceRef.current,
              id: selectedIdRef.current,
            },
            { selected: false }
          );
        }

        if (f.id == null) {
          console.warn("Feature has no id, feature-state 사용 불가", f);
        } else {
          map.setFeatureState(
            { source, id: f.id },
            { selected: true }
          );
        }

        selectedSourceRef.current = source;
        selectedIdRef.current = f.id;
        selectedGeomRef.current = f.geometry;

        const level = useProvince ? "prov" : "mun";
        const name = f.properties?.__NAME || `이름미상_${f.id}`;
        const code = f.properties?.__CODE || `idx_${f.id}`;
        const key = `${level}:${code}`;

        setSelectedLevel(level);
        setSelectedName(name);
        setSelectedKey(key);

        setNameCache((prev) => {
          if (prev[key] === name) return prev;
          const next = { ...prev, [key]: name };
          codeToNameRef.current[key] = name;
          return next;
        });
      });
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // ===== 미리보기 상태 =====
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImg, setPreviewImg] = useState(null); // HTMLImageElement
  const previewCanvasRef = useRef(null);
  const [previewParams, setPreviewParams] = useState({
    scale: 1.0,
    rotateDeg: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [previewGeom, setPreviewGeom] = useState(null); // { minX, minY, maxX, maxY, mercRings }

  // ===== 미리보기 렌더 =====
  const drawPreview = () => {
    if (!previewOpen || !previewImg || !previewGeom) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = canvas.__dpr || 1;
    const PRE_W = canvas.__cssW || Math.round(canvas.width / dpr);
    const PRE_H = canvas.__cssH || Math.round(canvas.height / dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const { mercRings, minX, minY, maxX, maxY } = previewGeom;
    const bboxW = Math.max(1e-12, maxX - minX);
    const bboxH = Math.max(1e-12, maxY - minY);

    const toCanvas = ([mx, my]) => [
      ((mx - minX) / bboxW) * PRE_W,
      ((my - minY) / bboxH) * PRE_H,
    ];

    ctx.clearRect(0, 0, PRE_W, PRE_H);
    ctx.save();

    // 클립
    ctx.beginPath();
    mercRings.forEach((ring) => {
      const [sx, sy] = toCanvas(ring[0]);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = toCanvas(ring[i]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    });
    ctx.clip("evenodd");

    const { scale, rotateDeg, offsetX, offsetY } = previewParams;
    ctx.translate(PRE_W / 2 + offsetX, PRE_H / 2 + offsetY);
    ctx.rotate((rotateDeg * Math.PI) / 180);
    ctx.imageSmoothingEnabled = true;

    const iw = previewImg.width,
      ih = previewImg.height;
    const coverS_pre = Math.max(PRE_W / iw, PRE_H / ih);
    const effScalePre = Math.max(0.001, scale) * coverS_pre;
    ctx.scale(effScalePre, effScalePre);

    ctx.drawImage(previewImg, -iw / 2, -ih / 2, iw, ih);

    ctx.restore();

    // 테두리 가이드
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    mercRings.forEach((ring) => {
      ctx.beginPath();
      const [sx, sy] = toCanvas(ring[0]);
      ctx.moveTo(sx, sy);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = toCanvas(ring[i]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    });
    ctx.restore();
  };

  useEffect(() => {
    drawPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, previewImg, previewGeom, previewParams]);

  // ===== 업로드 → 미리보기 진입 =====
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file || !selectedGeomRef.current) return;

    const geom = selectedGeomRef.current;

    const lngLatToMercXY = (lng, lat) => {
      const x = (lng + 180) / 360;
      const sin = Math.sin((lat * Math.PI) / 180);
      const y =
        0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
      return [x, y];
    };

    const ringsLngLat =
      geom.type === "Polygon"
        ? [geom.coordinates[0]]
        : geom.coordinates.map((p) => p[0]);

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const mercRings = ringsLngLat.map((ring) => {
      const mring = ring.map(([lng, lat]) => {
        const [mx, my] = lngLatToMercXY(lng, lat);
        if (mx < minX) minX = mx;
        if (my < minY) minY = my;
        if (mx > maxX) maxX = mx;
        if (my > maxY) maxY = my;
        return [mx, my];
      });
      return mring;
    });

    const EPS = 1e-6;
    minX -= EPS;
    minY -= EPS;
    maxX += EPS;
    maxY += EPS;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setUploadedImage(ev.target.result);
        setPreviewImg(img);

        const PRE_W = 360;
        const bboxW = Math.max(1e-12, maxX - minX);
        const bboxH = Math.max(1e-12, maxY - minY);
        const PRE_H = Math.max(
          1,
          Math.round((bboxH / bboxW) * PRE_W)
        );

        const cvs = previewCanvasRef.current;
        if (cvs) {
          const dpr = window.devicePixelRatio || 1;
          cvs.width = Math.max(1, Math.round(PRE_W * dpr));
          cvs.height = Math.max(1, Math.round(PRE_H * dpr));
          cvs.style.width = PRE_W + "px";
          cvs.style.height = PRE_H + "px";
          cvs.__dpr = dpr;
          cvs.__cssW = PRE_W;
          cvs.__cssH = PRE_H;
        }

        setPreviewGeom({
          minX,
          minY,
          maxX,
          maxY,
          mercRings,
        });

        setPreviewParams({
          scale: 1.0,
          rotateDeg: 0,
          offsetX: 0,
          offsetY: 0,
        });
        setPreviewOpen(true);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  // ===== 미리보기 적용 → 지도 (고해상도 렌더링 사용) =====
  const applyPreviewToMap = () => {
    try {
      if (
        !previewImg ||
        !previewGeom ||
        !selectedName ||
        !selectedLevel
      ) {
        alert("이미지/영역 정보가 없습니다.");
        return;
      }
      const map = mapRef.current;
      if (!map) return;

      if (!map.isStyleLoaded()) {
        map.once("idle", () =>
          requestAnimationFrame(applyPreviewToMap)
        );
        return;
      }

      const { minX, minY, maxX, maxY } = previewGeom;

      const previewCanvas = previewCanvasRef.current;
      if (!previewCanvas) {
        alert("프리뷰 캔버스를 찾을 수 없습니다.");
        return;
      }

      const hiCanvas = document.createElement("canvas");
      renderHighResCanvas(
        hiCanvas,
        previewCanvas,
        previewGeom,
        previewImg,
        previewParams
      );

      // 머서터 → 경위도 역변환
      const mercToLngLat = (mx, my) => {
        const lng = mx * 360 - 180;
        const lat =
          (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) /
          Math.PI;
        return [lng, lat];
      };
      const topLeft = mercToLngLat(minX, minY);
      const topRight = mercToLngLat(maxX, minY);
      const bottomRight = mercToLngLat(maxX, maxY);
      const bottomLeft = mercToLngLat(minX, maxY);

      const safeName = (selectedName || "region").replace(
        /\s+/g,
        "_"
      );
      const sourceId = `${
        selectedLevel === "prov" ? "province" : "municipality"
      }-${uniqueId(safeName)}`;
      const layerId = `${sourceId}-layer`;

      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);

      map.addSource(sourceId, {
        type: "canvas",
        canvas: hiCanvas,
        coordinates: [topLeft, topRight, bottomRight, bottomLeft],
        animate: false,
      });

      map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        layout: {
          visibility: selectedLevel === "prov" ? "visible" : "none",
        },
        paint: { "raster-opacity": 1.0 },
      });

      regionCanvasesRef.current[selectedName] = {
        sourceId,
        layerId,
        canvas: hiCanvas,
        isProvinceLevel: selectedLevel === "prov",
      };

      try {
        syncLayersRef.current();
      } catch (error) {
        console.warn("syncLayers 호출 중 오류:", error);
      }

      alert(`${selectedName}에 이미지가 적용되었습니다 ✅`);

      // ✅ 적용 후에는 미리보기/원본 이미지 상태 정리 (모바일에서 너무 크게 안 보이게)
      setPreviewOpen(false);
      setUploadedImage(null);
      setPreviewImg(null);
      setPreviewGeom(null);
    } catch (err) {
      console.error(err);
      alert(
        "이미지 적용 중 오류가 발생했습니다. 콘솔 로그를 캡처해 알려주면 바로 잡아줄게!"
      );
    }
  };

  // ===== 검색 =====
  const handleSearch = async (e) => {
    if (e.key !== "Enter") return;
    const q = searchInput.trim();
    if (!q) return;

    try {
      const query = encodeURIComponent(q);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxgl.accessToken}&country=KR&limit=1`;
      const res = await fetch(url);
      const data = await res.json();

      if (data?.features?.length) {
        const [lng, lat] = data.features[0].center;
        const map = mapRef.current;
        if (!map) return;

        map.flyTo({ center: [lng, lat], zoom: 9 });

        if (markerRef.current) markerRef.current.remove();
        markerRef.current = new mapboxgl.Marker({
          color: "#ff0000",
        })
          .setLngLat([lng, lat])
          .addTo(map);
      } else {
        alert("주소를 찾을 수 없습니다 😥");
      }
    } catch (err) {
      console.error(err);
      alert("검색 중 오류가 발생했습니다.");
    }
  };

  // ===== 좋아요 =====
  const handleLike = () => {
    if (!selectedKey || !selectedName) {
      alert("먼저 지도의 구역을 클릭해주세요.");
      return;
    }
    if (!canLikeNowGlobal()) {
      const remain = remainSecondsGlobal();
      const mm = Math.floor(remain / 60);
      const ss = String(remain % 60).padStart(2, "0");
      alert(`개인 쿨타임 중입니다. (${mm}:${ss} 남음)`);
      return;
    }
    setLikes((prev) => ({
      ...prev,
      [selectedKey]: (prev[selectedKey] || 0) + 1,
    }));
    setUserLastLikeTs(Date.now());
  };

  const selectedCount = likes[selectedKey] || 0;

  // useMemo 대신 즉시 실행 함수로 변경 (eslint 경고 제거)
  const cooldownText = (() => {
    const remain = remainSecondsGlobal();
    if (remain <= 0) return "지금 좋아요 가능!";
    const mm = Math.floor(remain / 60);
    const ss = String(remain % 60).padStart(2, "0");
    return `개인 쿨타임 ${mm}:${ss}`;
  })();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
      }}
    >
      <div
        ref={mapContainerRef}
        style={{ position: "absolute", inset: 0 }}
      />

      {/* 좌측 상단: 누적 좋아요 TOP 5 패널 (모바일에서 더 작게, 왼쪽 고정) */}
      <div
        style={{
          position: "absolute",
          top: isMobile ? 80 : 20,
          left: isMobile ? 10 : 20,
          transform: "none",
          background: "rgba(255,255,255,0.92)",
          borderRadius: 10,
          boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
          padding: isMobile ? "8px 10px" : "12px 14px",
          width: isMobile ? 260 : 340,
          maxWidth: isMobile ? 260 : 400,
          zIndex: 15,
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            marginBottom: 6,
            fontSize: 14,
            textAlign: "left",
          }}
        >
          누적 좋아요 TOP 5
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
            gap: 12,
          }}
        >
          {/* 시/도 Top5 */}
          <div>
            <div
              style={{
                fontWeight: 600,
                marginBottom: 6,
                fontSize: 14,
              }}
            >
              시/도
            </div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {topProv.length ? (
                topProv.map(([key, cnt]) => (
                  <li
                    key={key}
                    style={{
                      marginBottom: 6,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                    }}
                    title={`${keyToName(key)} · ♥ ${cnt}`}
                  >
                    <span
                      title={keyToName(key)}
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: isMobile ? 160 : 180,
                      }}
                    >
                      {keyToName(key)}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        lineHeight: "14px",
                        borderRadius: 999,
                        padding: "2px 8px",
                        border: "1px solid #ffd6e0",
                        background: "#fff0f3",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                      }}
                      aria-label={`좋아요 ${cnt}개`}
                    >
                      ♥ {formatCount(cnt)}
                    </span>
                  </li>
                ))
              ) : (
                <li style={{ fontSize: 12, color: "#666" }}>
                  데이터 없음
                </li>
              )}
            </ol>
          </div>

          {/* 시/군/구 Top5 */}
          <div>
            <div
              style={{
                fontWeight: 600,
                marginBottom: 6,
                fontSize: 14,
              }}
            >
              시/군/구
            </div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {topMun.length ? (
                topMun.map(([key, cnt]) => (
                  <li
                    key={key}
                    style={{
                      marginBottom: 6,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                    }}
                    title={`${keyToName(key)} · ♥ ${cnt}`}
                  >
                    <span
                      title={keyToName(key)}
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: isMobile ? 160 : 180,
                      }}
                    >
                      {keyToName(key)}
                    </span>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 12,
                        lineHeight: "14px",
                        borderRadius: 999,
                        padding: "2px 8px",
                        border: "1px solid #ffd6e0",
                        background: "#fff0f3",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        flexShrink: 0,
                      }}
                      aria-label={`좋아요 ${cnt}개`}
                    >
                      ♥ {formatCount(cnt)}
                    </span>
                  </li>
                ))
              ) : (
                <li style={{ fontSize: 12, color: "#666" }}>
                  데이터 없음
                </li>
              )}
            </ol>
          </div>
        </div>
      </div>

      {/* 중앙 상단: 검색 */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: "50%",
          transform: "translateX(-50%)",
          background: "white",
          borderRadius: 8,
          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          padding: "6px 10px",
          zIndex: 20, // TOP 패널보다 위로
          maxWidth: "90vw",
        }}
      >
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleSearch}
          placeholder="주소를 입력하세요 (예: 서울특별시 강남구)"
          style={{
            border: "none",
            outline: "none",
            width: isMobile ? "70vw" : 280,
            maxWidth: 320,
            fontSize: 14,
          }}
        />
      </div>

      {/* 업로드/좋아요 팝업 */}
      {selectedKey && selectedName && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(0,0,0,0.25)",
            padding: isMobile ? "18px 16px" : "24px 28px",
            width: isMobile ? "90vw" : 380,
            maxWidth: 420,
            textAlign: "center",
            zIndex: 30,
          }}
        >
          <p
            style={{
              marginBottom: 8,
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            {selectedName} (
            {selectedLevel === "prov" ? "시/도" : "시/군/구"})
          </p>

          <div
            style={{
              fontSize: 12,
              color: "#666",
              marginBottom: 14,
            }}
          >
            누적 좋아요: <b>{formatCount(selectedCount)}</b>
            <span
              style={{
                marginLeft: 6,
                color: canLikeNowGlobal() ? "#2a7" : "#e55",
              }}
            >
              {cooldownText}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: isMobile ? "column" : "row",
              gap: 8,
              justifyContent: "center",
              marginBottom: 10,
            }}
          >
            <button
              onClick={handleLike}
              style={{
                backgroundColor: "#ff3366",
                color: "#fff",
                border: "none",
                padding: "10px 16px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 700,
                flex: 1,
              }}
            >
              ♥ 좋아요
            </button>

            <label
              style={{
                backgroundColor: "#f1f5f9",
                color: "#111827",
                border: "1px solid #e5e7eb",
                padding: "10px 16px",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                flex: 1,
              }}
            >
              이미지 업로드
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {uploadedImage && !previewOpen && (
            <img
              src={uploadedImage}
              alt="preview"
              style={{
                width: "100%",
                borderRadius: 8,
                marginBottom: 12,
                border: "1px solid #eee",
              }}
            />
          )}

          {/* 미리보기 */}
          {previewOpen && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#fafafa",
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                이미지 미리보기 (배치 조절)
              </div>
              <canvas
                ref={previewCanvasRef}
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: 8,
                  background: "#fff",
                }}
              />
              <div
                style={{
                  textAlign: "left",
                  marginTop: 10,
                  display: "grid",
                  gap: 8,
                }}
              >
                <label style={{ fontSize: 12 }}>
                  확대(Scale):&nbsp;
                  <input
                    type="range"
                    min="0.3"
                    max="3"
                    step="0.01"
                    value={previewParams.scale}
                    onChange={(e) =>
                      setPreviewParams((p) => ({
                        ...p,
                        scale: parseFloat(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  회전(Rotate):&nbsp;
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={previewParams.rotateDeg}
                    onChange={(e) =>
                      setPreviewParams((p) => ({
                        ...p,
                        rotateDeg: parseFloat(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  X 이동:&nbsp;
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    step="1"
                    value={previewParams.offsetX}
                    onChange={(e) =>
                      setPreviewParams((p) => ({
                        ...p,
                        offsetX: parseFloat(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  Y 이동:&nbsp;
                  <input
                    type="range"
                    min="-200"
                    max="200"
                    step="1"
                    value={previewParams.offsetY}
                    onChange={(e) =>
                      setPreviewParams((p) => ({
                        ...p,
                        offsetY: parseFloat(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                  />
                </label>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  <button
                    onClick={() =>
                      setPreviewParams({
                        scale: 1.0,
                        rotateDeg: 0,
                        offsetX: 0,
                        offsetY: 0,
                      })
                    }
                    style={{
                      flex: 1,
                      background: "#f1f5f9",
                      border: "1px solid #e5e7eb",
                      padding: "8px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    초기화
                  </button>
                  <button
                    onClick={applyPreviewToMap}
                    style={{
                      flex: 1,
                      background: "#0ea5e9",
                      color: "#fff",
                      border: "none",
                      padding: "8px 10px",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontWeight: 700,
                    }}
                  >
                    적용
                  </button>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setSelectedKey(null);
              setSelectedName(null);
              setSelectedLevel(null);
              setUploadedImage(null);
              setPreviewOpen(false);
              setPreviewImg(null);
              setPreviewGeom(null);
            }}
            style={{
              backgroundColor: "#007bff",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: 6,
              cursor: "pointer",
              marginTop: 12,
              width: "100%",
            }}
          >
            닫기
          </button>
        </div>
      )}

      {/* 오른쪽 아래: 저작권 표기 */}
      <div
        style={{
          position: "absolute",
          right: 10,
          bottom: 6,
          fontSize: 10,
          color: "rgba(0,0,0,0.5)",
          background: "rgba(255,255,255,0.6)",
          padding: "3px 6px",
          borderRadius: 4,
          pointerEvents: "none",
        }}
      >
        행정구역 경계 데이터 ⓒ 통계청 통계지리정보서비스(SGIS)
      </div>
    </div>
  );
}

export default App;
