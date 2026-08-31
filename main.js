// 메이플랜드 홀심 알리미
// 난독화본(main.obfuscated.backup.js)에서 복원한 코드 — 동작 동일

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const alertSound = document.getElementById('alertSound');
const statusIndicator = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const currentTemplateNameSpan = document.getElementById('currentTemplateName');
const roiWidthInput = document.getElementById('roiWidthInput');
const roiHeightInput = document.getElementById('roiHeightInput');
const roiYInput = document.getElementById('roiYInput');
const matchThresholdInput = document.getElementById('matchThresholdInput');
const alarmTargetInput = document.getElementById('alarmTargetInput');
const btn1600w = document.getElementById('btn1600w');
const btn1600f = document.getElementById('btn1600f');

let currentRoiWidth = parseInt(roiWidthInput.value) || 600;
let currentRoiHeight = parseInt(roiHeightInput.value) || 70;
let currentRoiY = parseInt(roiYInput.value) || 120;
let currentMatchThreshold = parseFloat(matchThresholdInput.value) || 0.965;

const DETECTION_INTERVAL = 500; // ms, 탐지 주기

let isOpenCVReady = false;
let isSharing = false;
let currentStream = null;
let currentTemplateMat = null;
let resultMat = null;
let currentDetectionIntervalId = null;
let countdownTimerId = null;

// OpenCV.js 로딩 대기
const waitForCV = setInterval(() => {
	if (typeof cv !== 'undefined' && cv.matFromImageData) {
		clearInterval(waitForCV);
		isOpenCVReady = true;
		console.log('[' + new Date().toLocaleTimeString() + '] ✅ OpenCV 로딩 완료');
	}
}, 100);

// 해상도별 템플릿 이미지 / ROI 프리셋
const templateMap = {
	'1600w': { url: './img/1600/25.png', name: '1600 (창모드)', rolw: 600, rolh: 70, roly: 120 },
	'1600f': { url: './img/1600/25f.png', name: '1600 (전체화면)', rolw: 600, rolh: 70, roly: 120 }
};

async function loadTemplateImage(url, name, rolw, rolh, roly) {
	try {
		const img = new Image();
		img.src = url;
		await new Promise(resolve => img.onload = resolve);

		const tmpCanvas = document.createElement('canvas');
		tmpCanvas.width = img.naturalWidth;
		tmpCanvas.height = img.naturalHeight;
		const tmpCtx = tmpCanvas.getContext('2d');
		tmpCtx.drawImage(img, 0, 0);
		const imageData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);

		if (currentTemplateMat) currentTemplateMat.delete();
		currentTemplateMat = cv.matFromImageData(imageData);
		if (resultMat) resultMat.delete();
		resultMat = new cv.Mat(1, 1, cv.CV_32FC1);

		currentTemplateNameSpan.textContent = name;

		if (rolw !== undefined) {
			currentRoiWidth = parseInt(rolw);
			roiWidthInput.value = currentRoiWidth;
		}
		if (rolh !== undefined) {
			currentRoiHeight = parseInt(rolh);
			roiHeightInput.value = currentRoiHeight;
		}
		if (roly !== undefined) {
			currentRoiY = parseInt(roly);
			roiYInput.value = currentRoiY;
		}

		console.log('[' + new Date().toLocaleTimeString() + "] ✅ 템플릿 '" + name + "' 로드 완료");
	} catch (err) {
		statusIndicator.textContent = '⚠️ 템플릿 로드 실패';
		console.error('[' + new Date().toLocaleTimeString() + '] ❌ 템플릿 로드 실패: ' + url, err);
	}
}

// 화면 공유 시작
startBtn.addEventListener('click', async () => {
	if (!isOpenCVReady || !currentTemplateMat) {
		statusIndicator.textContent = '⚠️ OpenCV 또는 템플릿이 준비되지 않았습니다.';
		console.warn('[' + new Date().toLocaleTimeString() + '] ⚠️ OpenCV 또는 템플릿이 준비되지 않았습니다.');
		return;
	}
	try {
		const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
		// 이전 공유가 있으면 정리 (재클릭 시 스트림 누수 방지)
		if (currentStream) currentStream.getTracks().forEach(t => t.stop());
		currentStream = stream;
		video.srcObject = stream;
		isSharing = true;
		statusIndicator.textContent = '🟢 화면 공유 중';
		console.log('[' + new Date().toLocaleTimeString() + '] 🟢 화면 공유 시작');

		stream.getVideoTracks()[0].addEventListener('ended', () => {
			isSharing = false;
			statusIndicator.textContent = '🔴 공유 안 됨';
			if (currentDetectionIntervalId) {
				clearInterval(currentDetectionIntervalId);
				currentDetectionIntervalId = null;
				console.log('[' + new Date().toLocaleTimeString() + '] 🔴 화면 공유 종료됨');
			}
		});

		video.onloadedmetadata = () => {
			if (currentDetectionIntervalId) clearInterval(currentDetectionIntervalId);
			currentDetectionIntervalId = setInterval(() => {
				isSharing && detectImageOnScreen(currentRoiWidth, currentRoiHeight, currentRoiY, currentMatchThreshold, currentTemplateMat);
			}, DETECTION_INTERVAL);
		};
	} catch (err) {
		statusIndicator.textContent = '⚠️ 공유 실패';
		console.error('[' + new Date().toLocaleTimeString() + '] ❌ 화면 공유 실패:', err);
	}
});

// 템플릿(25초 아이콘) 감지 시점 기준으로, 목표 시간에 맞춰 알람 예약
function triggerCountdown(targetSeconds) {
	// 이미 예약된 알람이 있으면 유지 (아이콘이 떠 있는 동안 재감지돼도 알람이 밀리지 않게)
	if (countdownTimerId) return;

	const delay = 24 - targetSeconds;
	if (delay <= 0) {
		statusIndicator.textContent = '⚠️ 목표 시간이 25 이상이거나 잘못되었습니다.';
		console.warn('⚠️ 목표 시간이 25 이상이거나 잘못되었습니다.');
		return;
	}

	if (isSharing) statusIndicator.textContent = '🟢 화면 공유 중';
	console.log('⏱️ ' + targetSeconds + '초 시점 알람 예약됨 (지연 ' + delay + '초)');
	countdownTimerId = setTimeout(() => {
		alertSound.currentTime = 0;
		alertSound.play();
		console.log('🔔 ' + targetSeconds + '초 시점 알람 실행!');
		countdownTimerId = null;
	}, delay * 1000);
}

// 화면 우측 ROI에서 템플릿 매칭
function detectImageOnScreen(roiWidth, roiHeight, roiY, matchThreshold, templateMat) {
	if (video.videoWidth === 0 || video.videoHeight === 0) return;

	// ROI는 화면 오른쪽 끝 기준
	const sx = video.videoWidth - roiWidth;
	const sy = roiY;

	canvas.width = roiWidth;
	canvas.height = roiHeight;
	ctx.drawImage(video, sx, sy, roiWidth, roiHeight, 0, 0, roiWidth, roiHeight);

	const imageData = ctx.getImageData(0, 0, roiWidth, roiHeight);
	const srcMat = cv.matFromImageData(imageData);

	const resultCols = srcMat.cols - templateMat.cols + 1;
	const resultRows = srcMat.rows - templateMat.rows + 1;
	if (resultCols <= 0 || resultRows <= 0) {
		console.warn('[' + new Date().toLocaleTimeString() + '] ⚠️ 템플릿이 ROI보다 큽니다.');
		srcMat.delete();
		return;
	}

	if (resultMat) resultMat.delete();
	resultMat = new cv.Mat(resultRows, resultCols, cv.CV_32FC1);
	cv.matchTemplate(srcMat, templateMat, resultMat, cv.TM_CCOEFF_NORMED);

	const { maxVal } = cv.minMaxLoc(resultMat);
	const matched = maxVal >= matchThreshold;

	if (maxVal > 0.9) {
		console.log('[' + new Date().toLocaleTimeString() + '] 매칭율: ' + (maxVal * 100).toFixed(2) + '%');
	}

	if (matched) {
		const targetSeconds = parseInt(alarmTargetInput.value) || 10;
		triggerCountdown(targetSeconds);
	}

	srcMat.delete();
}

// 설정 입력값 변경 반영 (빈 칸/잘못된 값이면 기존 값 유지)
roiWidthInput.addEventListener('change', e => {
	const v = parseInt(e.target.value);
	if (!isNaN(v)) currentRoiWidth = v;
});
roiHeightInput.addEventListener('change', e => {
	const v = parseInt(e.target.value);
	if (!isNaN(v)) currentRoiHeight = v;
});
roiYInput.addEventListener('change', e => {
	const v = parseInt(e.target.value);
	if (!isNaN(v)) currentRoiY = v;
});
matchThresholdInput.addEventListener('change', e => {
	const v = parseFloat(e.target.value);
	if (!isNaN(v)) currentMatchThreshold = v;
});

// 해상도 버튼
btn1600w.addEventListener('click', () => {
	const t = templateMap['1600w'];
	loadTemplateImage(t.url, t.name, t.rolw, t.rolh, t.roly);
});
btn1600f.addEventListener('click', () => {
	const t = templateMap['1600f'];
	loadTemplateImage(t.url, t.name, t.rolw, t.rolh, t.roly);
});

// 페이지 종료 시 OpenCV 메모리 해제
window.addEventListener('beforeunload', () => {
	currentTemplateMat?.delete();
	resultMat?.delete();
	console.log('[' + new Date().toLocaleTimeString() + '] 🧹 OpenCV Mat 메모리 해제 완료');
});
