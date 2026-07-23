package com.tableplan.config

import com.tableplan.auth.ApiKeyAuthenticationFilter
import com.tableplan.auth.ApiScopeFilter
import com.tableplan.auth.GoogleOAuthSuccessHandler
import com.tableplan.auth.SessionAuthenticationFilter
import org.springframework.beans.factory.ObjectProvider
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository
import org.springframework.security.web.access.intercept.AuthorizationFilter
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter
import org.springframework.security.web.csrf.CookieCsrfTokenRepository
import org.springframework.security.web.util.matcher.AndRequestMatcher
import org.springframework.security.web.util.matcher.NegatedRequestMatcher
import org.springframework.security.web.util.matcher.RequestHeaderRequestMatcher

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class SecurityConfiguration(
    private val sessionAuthenticationFilter: SessionAuthenticationFilter,
    private val apiKeyAuthenticationFilter: ApiKeyAuthenticationFilter,
    private val apiScopeFilter: ApiScopeFilter,
    private val googleOAuthSuccessHandler: GoogleOAuthSuccessHandler,
    private val clientRegistrations: ObjectProvider<ClientRegistrationRepository>,
) {
    @org.springframework.context.annotation.Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        val csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse()
        csrfRepository.setCookiePath("/")
        http
            .addFilterBefore(sessionAuthenticationFilter, AnonymousAuthenticationFilter::class.java)
            .addFilterAfter(apiKeyAuthenticationFilter, SessionAuthenticationFilter::class.java)
            .addFilterAfter(apiScopeFilter, ApiKeyAuthenticationFilter::class.java)
            .authorizeHttpRequests {
                it.requestMatchers(
                    "/",
                    "/index.html",
                    "/assets/**",
                    "/favicon.ico",
                    "/health/live",
                    "/health/ready",
                    "/api/v1/health",
                    "/api/v1/system/version",
                    "/api/v1/openapi.json",
                    "/api/auth/**",
                    "/oauth2/**",
                    "/login/oauth2/**",
                    "/api/public/**",
                    "/recipes",
                    "/recipes/**",
                    "/sign-in",
                    "/login",
                    "/register",
                    "/auth/error",
                    "/plan",
                    "/shopping",
                    "/settings",
                    "/favorites",
                    "/household/join",
                    "/shared/**",
                ).permitAll()
                it.requestMatchers(HttpMethod.GET, "/api/v1/recipes/**").permitAll()
                it.anyRequest().authenticated()
            }
            .csrf {
                it.csrfTokenRepository(csrfRepository)
                    .requireCsrfProtectionMatcher(
                        AndRequestMatcher(
                            org.springframework.security.web.csrf.CsrfFilter.DEFAULT_CSRF_MATCHER,
                            NegatedRequestMatcher(RequestHeaderRequestMatcher(HttpHeaders.AUTHORIZATION)),
                        ),
                    )
                    .ignoringRequestMatchers(
                        "/api/v1/health",
                        "/api/public/shopping/exchange",
                        "/api/public/shopping/logout",
                    )
            }
            .exceptionHandling {
                it.authenticationEntryPoint { request, response, _ ->
                    response.status = 401
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    response.writer.write(
                        """{"code":"authentication_required","message":"Authentication is required.","requestId":"${request.getAttribute(com.tableplan.api.REQUEST_ID_ATTRIBUTE)}"}""",
                    )
                }
                it.accessDeniedHandler { request, response, _ ->
                    response.status = 403
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    response.writer.write(
                        """{"code":"access_denied","message":"The request is not allowed.","requestId":"${request.getAttribute(com.tableplan.api.REQUEST_ID_ATTRIBUTE)}"}""",
                    )
                }
            }
            .headers {
                it.contentSecurityPolicy { policy ->
                    policy.policyDirectives(
                        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
                            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
                    )
                }
                it.referrerPolicy { policy ->
                    policy.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)
                }
            }
        if (clientRegistrations.ifAvailable != null) {
            http.oauth2Login { it.successHandler(googleOAuthSuccessHandler) }
        }
        return http.build()
    }
}
