<?php

function exportImage(array $request): object
{
    $width = (int) $request['width'];
    $height = (int) $request['height'];
    if ($width < 1 || $height < 1 || $width > 4096 || $height > 4096 || $width * $height > 8000000) {
        throw new InvalidArgumentException('Unsupported image dimensions.');
    }
    return imagecreatetruecolor($width, $height);
}
