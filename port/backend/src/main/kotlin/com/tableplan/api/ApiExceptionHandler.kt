package com.tableplan.api

import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.ConstraintViolationException
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import java.util.UUID

@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ApiException::class)
    fun apiException(exception: ApiException, request: HttpServletRequest): ResponseEntity<ApiError> =
        ResponseEntity.status(exception.status).body(
            ApiError(exception.code, exception.message, request.requestId()),
        )

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalidBody(
        exception: MethodArgumentNotValidException,
        request: HttpServletRequest,
    ): ResponseEntity<ApiError> {
        val fields =
            exception.bindingResult.fieldErrors.associate {
                it.field to (it.defaultMessage ?: "Invalid value")
            }
        return ResponseEntity.badRequest().body(
            ApiError("validation_failed", "The request is invalid.", request.requestId(), fields),
        )
    }

    @ExceptionHandler(ConstraintViolationException::class)
    fun invalidParameter(
        exception: ConstraintViolationException,
        request: HttpServletRequest,
    ): ResponseEntity<ApiError> =
        ResponseEntity.badRequest().body(
            ApiError("validation_failed", "The request is invalid.", request.requestId()),
        )

    private fun HttpServletRequest.requestId(): UUID =
        getAttribute(REQUEST_ID_ATTRIBUTE) as? UUID ?: UUID.randomUUID()
}

