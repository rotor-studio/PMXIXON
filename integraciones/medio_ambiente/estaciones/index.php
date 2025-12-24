<?php
header('Content-Type: application/json; charset=utf-8');

$api_url = 'https://api.gijon.es/integraciones/medio_ambiente/estaciones';
$ayto_key = 'CmGAWLBOiFNF6';

$headers = [
    'Accept: application/json',
    'ayto-key: ' . $ayto_key,
    'Origin: https://www.gijon.es',
    'Referer: https://www.gijon.es/',
    'User-Agent: PMXIXON/1.0',
];

$ch = curl_init($api_url);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 8);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

if ($response === false || $http_code >= 400) {
    http_response_code(502);
    echo json_encode([
        'error' => 'No se pudo obtener estaciones oficiales.',
        'status' => $http_code,
        'detalle' => $curl_error,
    ]);
    exit;
}

echo $response;
